// Nexus.cs
//
// Signing in to Nexus Mods, and the downloads a Nexus Premium account gets
// through Nexus's API, for the modlist install's Nexus files (#6244).
//
// WHY. The collection's mods are Nexus files, and Nexus lets each person
// download them under their own account. Vortex signed them in until now;
// the launcher is taking that over, so Vortex can go. A free account still
// presses Manual Download on each file's page (ModlistFetch.ByHand), as it
// does in Vortex today; a Premium account gets every file without a press.
//
// THE SIGN IN is OAuth 2 with PKCE (RFC 7636), the way a desktop program signs
// in: the person's browser goes to Nexus's own page, Nexus sends it back to
// a listener on 127.0.0.1 with a code, and the launcher trades the code, with
// the verifier only it holds, for the account's tokens. The launcher never
// sees the password and nothing is pasted. The state rides out with the
// request and has to come back on the answer, so a request that did not start
// here is answered and ignored (Discord.Connect does the same). Nexus gives
// the launcher's client id when the launcher is registered with it, a one
// time step for the Nexus account holder; until then SignIn says so.
//
// THE TOKENS are kept in Profile\nexus.txt, encrypted for this Windows account
// (Secrets.cs), and the access token is renewed with the refresh token once
// it is within a minute of its end. Sign out forgets them.
//
// A DOWNLOAD asks Nexus's API for the file's link (download_link.json), which
// Nexus gives a Premium account only, writes the file through a .got beside
// its name as it arrives, and holds it to the modlist's size and xxHash64
// before it takes the name, as ModlistFetch.ByAddress does. Every request
// names the launcher and its version, as Nexus's API rules ask.
//
// tests\test-6244-nexus.ps1 holds it against a stand-in for Nexus on
// 127.0.0.1.

using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace Thornswood
{
    static class Nexus
    {
        /// <summary>Who is signed in, as Nexus said at the sign in.</summary>
        public sealed class Account
        {
            public string Name;
            public bool Premium;
        }

        sealed class Kept
        {
            public string Access;
            public string Refresh;
            public DateTime Ends;
            public string Name;
            public bool Premium;
        }

        // Where Nexus is. Not readonly, so a harness can point them at its
        // own stand-in; nothing in the launcher writes them.
        internal static string Users = "https://users.nexusmods.com";
        internal static string Api = "https://api.nexusmods.com/v1";

        /// <summary>
        /// The id Nexus gives Thornswood's launcher when it is registered
        /// with Nexus (#6244). Empty until then.
        /// </summary>
        internal static string ClientId = "";

        /// <summary>The address Nexus sends the browser back to, registered with the client id.</summary>
        internal const int Port = 53150;
        internal static string Back { get { return CallbackAddress(Port); } }
        static string CallbackAddress(int port) { return "http://127.0.0.1:" + port + "/nexus"; }
        const string Scope = "openid profile";

        /// <summary>Profile\nexus.txt's folder. Paths.ProfileDir unless a harness says otherwise.</summary>
        internal static string Folder = null;
        static string KeptFile { get { return Path.Combine(Folder ?? Paths.ProfileDir, "nexus.txt"); } }

        // How the tokens are sealed on disk: Secrets.cs, for this Windows
        // account. A harness off Windows puts its own here.
        internal static Func<string, string> Seal = Secrets.Protect;
        internal static Func<string, string> Unseal = Secrets.Unprotect;

        const int AnswerMs = 15000;
        static readonly object gate = new object();

        /// <summary>Who is signed in, or null when nobody is.</summary>
        public static Account Who
        {
            get
            {
                Kept k = Read();
                return k == null ? null : new Account { Name = k.Name, Premium = k.Premium };
            }
        }

        /// <summary>Forgets the account's tokens.</summary>
        public static void SignOut()
        {
            lock (gate)
            {
                try { if (File.Exists(KeptFile)) File.Delete(KeptFile); }
                catch (Exception ex) { throw new ModlistStop("The Nexus sign in could not be forgotten: " + Failure.Why("Nexus.SignOut", ex, KeptFile) + "."); }
            }
        }

        static string Url64(byte[] b)
        {
            return Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        /// <summary>
        /// Signs in to Nexus in the person's browser, which
        /// <paramref name="open"/> sends to Nexus's sign in page, and waits
        /// up to <paramref name="wait"/> for it to come back. Keeps the
        /// account's tokens and says who it is. Throws ModlistStop with the
        /// reason, keeping nothing.
        /// </summary>
        public static Account SignIn(Action<string> open, TimeSpan wait)
        {
            return SignInOnLoopbackPort(open, wait, Port);
        }

        // The harness shares its stand-in's ephemeral port. Normal sign-in
        // always listens on the port registered with Nexus.
        internal static Account SignInOnLoopbackPort(Action<string> open, TimeSpan wait, int port)
        {
            if (string.IsNullOrEmpty(ClientId))
                throw new ModlistStop("This launcher is not registered with Nexus yet, so it cannot sign in to Nexus. Download each file with Manual Download instead.");
            string verifier = Url64(RandomNumberGenerator.GetBytes(32));
            string challenge = Url64(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
            string state = Url64(RandomNumberGenerator.GetBytes(24));

            string callback = CallbackAddress(port);
            var listener = new HttpListener();
            listener.Prefixes.Add(callback + "/");
            try { listener.Start(); }
            catch (Exception ex) { throw new ModlistStop("The Nexus sign in could not listen on port " + port + " for Nexus's answer: " + Failure.Why("Nexus.SignIn, listen", ex) + "."); }
            try
            {
                string page = Users + "/oauth/authorize?response_type=code" +
                              "&client_id=" + Uri.EscapeDataString(ClientId) +
                              "&redirect_uri=" + Uri.EscapeDataString(callback) +
                              "&scope=" + Uri.EscapeDataString(Scope) +
                              "&state=" + state +
                              "&code_challenge=" + challenge +
                              "&code_challenge_method=S256";
                try { open(page); }
                catch (Exception ex) { throw new ModlistStop("Your browser could not be opened for the Nexus sign in: " + Failure.Why("Nexus.SignIn, open the browser", ex) + "."); }
                string code = WaitForCode(listener, state, wait);
                Kept k = Trade(new[] { "grant_type", "authorization_code", "client_id", ClientId, "code", code, "redirect_uri", callback, "code_verifier", verifier }, null, "Nexus did not sign you in: ");
                Learn(k);
                Write(k);
                return new Account { Name = k.Name, Premium = k.Premium };
            }
            finally
            {
                try { listener.Stop(); listener.Close(); }
                catch (Exception ex) { Swallow.Note("Nexus.SignIn, stop listening", ex); }
            }
        }

        // The code Nexus sends the browser back with. A request that is not
        // from this machine, not to the address, or without this sign in's
        // state is answered and ignored, and the wait goes on.
        static string WaitForCode(HttpListener listener, string state, TimeSpan wait)
        {
            DateTime end = DateTime.UtcNow + wait;
            while (true)
            {
                TimeSpan left = end - DateTime.UtcNow;
                if (left <= TimeSpan.Zero) throw new ModlistStop("Nexus did not send the browser back within " + (int)wait.TotalMinutes + " minutes, so the sign in stopped. Press Sign in to Nexus again.");
                var next = listener.GetContextAsync();
                if (!next.Wait(left)) continue;
                HttpListenerContext ctx = next.Result;
                var q = ctx.Request.QueryString;
                bool here = ctx.Request.RemoteEndPoint != null && IPAddress.IsLoopback(ctx.Request.RemoteEndPoint.Address);
                bool mine = here && ctx.Request.Url.AbsolutePath == "/nexus" && q["state"] == state;
                string error = mine ? q["error"] : null;
                string code = mine ? q["code"] : null;
                bool good = mine && error == null && !string.IsNullOrEmpty(code);
                Answer(ctx, good ? "Signed in" : mine ? "Not signed in" : "Not this one",
                       good ? "You can close this and go back to the launcher."
                            : mine ? "Nexus said no. Close this and look at the launcher."
                                   : "That did not come from the launcher's Sign in to Nexus, so it was ignored.");
                if (!mine) continue;
                if (error != null) throw new ModlistStop("Nexus did not sign you in: " + (q["error_description"] ?? error) + ".");
                if (!good) throw new ModlistStop("Nexus sent the browser back without a sign in code.");
                return code;
            }
        }

        static void Answer(HttpListenerContext ctx, string title, string line)
        {
            try
            {
                byte[] b = Encoding.UTF8.GetBytes("<!doctype html><meta charset=utf-8><title>Thornswood</title>" +
                    "<body style=\"background:#12150F;color:#DDE3D5;font:15px/1.6 system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center\">" +
                    "<div><h1 style=\"color:#C9A24B;font-weight:600\">" + title + "</h1><p>" + line + "</p></div></body>");
                ctx.Response.ContentType = "text/html; charset=utf-8";
                ctx.Response.ContentLength64 = b.Length;
                ctx.Response.OutputStream.Write(b, 0, b.Length);
                ctx.Response.Close();
            }
            catch (Exception ex) { Swallow.Note("Nexus.Answer, the browser's page", ex); }
        }

        static HttpRequestMessage Request(HttpMethod how, string url)
        {
            var req = new HttpRequestMessage(how, url);
            req.Headers.TryAddWithoutValidation("User-Agent", "ThornswoodLauncher/" + Updater.Version);
            req.Headers.TryAddWithoutValidation("Application-Name", "Thornswood");
            req.Headers.TryAddWithoutValidation("Application-Version", Updater.Version);
            req.Headers.TryAddWithoutValidation("Accept", "application/json");
            return req;
        }

        static JsonDocument Json(HttpRequestMessage req, string what)
        {
            using (req)
            using (HttpResponseMessage res = Http.Send(req, AnswerMs))
            {
                string body = res.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                if (!res.IsSuccessStatusCode)
                {
                    string said = "";
                    try
                    {
                        using (JsonDocument d = JsonDocument.Parse(body))
                            foreach (string k in new[] { "error_description", "message", "error" })
                                if (d.RootElement.ValueKind == JsonValueKind.Object && d.RootElement.TryGetProperty(k, out JsonElement e) && e.ValueKind == JsonValueKind.String) { said = ": " + e.GetString(); break; }
                    }
                    catch (JsonException ex) { Swallow.Note("Nexus.Json, the refusal's words", ex); }
                    throw new NexusRefused((int)res.StatusCode, "Nexus answered " + (int)res.StatusCode + " " + res.ReasonPhrase + " to " + what + said);
                }
                return JsonDocument.Parse(body);
            }
        }

        sealed class NexusRefused : Exception
        {
            public readonly int Status;
            public NexusRefused(int status, string message) : base(message) { Status = status; }
        }

        // The token endpoint, for a code or a refresh token. The account's
        // name and Premium are carried over from before (a refresh), or read
        // after (a sign in). A refusal starts with <no>.
        static Kept Trade(string[] form, Kept before, string no)
        {
            var pairs = new List<KeyValuePair<string, string>>();
            for (int i = 0; i < form.Length; i += 2) pairs.Add(new KeyValuePair<string, string>(form[i], form[i + 1]));
            HttpRequestMessage req = Request(HttpMethod.Post, Users + "/oauth/token");
            req.Content = new FormUrlEncodedContent(pairs);
            try
            {
                using (JsonDocument d = Json(req, "the sign in"))
                {
                    JsonElement r = d.RootElement;
                    string access = Str(r, "access_token");
                    if (string.IsNullOrEmpty(access)) throw new ModlistStop(no + "Nexus's answer held no access token.");
                    long seconds = r.TryGetProperty("expires_in", out JsonElement e) && e.ValueKind == JsonValueKind.Number ? e.GetInt64() : 0;
                    if (seconds <= 0) throw new ModlistStop(no + "Nexus's answer did not say when its token ends.");
                    return new Kept
                    {
                        Access = access,
                        Refresh = Str(r, "refresh_token") ?? (before == null ? null : before.Refresh),
                        Ends = DateTime.UtcNow.AddSeconds(seconds),
                        Name = before == null ? null : before.Name,
                        Premium = before != null && before.Premium,
                    };
                }
            }
            catch (ModlistStop) { throw; }
            catch (Exception ex) { throw new ModlistStop(no + Failure.Why("Nexus.Trade", ex) + "."); }
        }

        static string Str(JsonElement o, string name)
        {
            return o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out JsonElement e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;
        }

        // The account's name and whether it is Premium (membership_roles).
        static void Learn(Kept k)
        {
            HttpRequestMessage req = Request(HttpMethod.Get, Users + "/oauth/userinfo");
            req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + k.Access);
            try
            {
                using (JsonDocument d = Json(req, "who you are"))
                {
                    k.Name = Str(d.RootElement, "name") ?? "";
                    k.Premium = false;
                    if (d.RootElement.TryGetProperty("membership_roles", out JsonElement roles) && roles.ValueKind == JsonValueKind.Array)
                        foreach (JsonElement x in roles.EnumerateArray())
                            if (x.ValueKind == JsonValueKind.String && x.GetString() == "premium") k.Premium = true;
                }
            }
            catch (Exception ex) { throw new ModlistStop("Nexus did not say who you are: " + Failure.Why("Nexus.Learn", ex) + "."); }
        }

        static void Write(Kept k)
        {
            var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms))
            {
                w.WriteStartObject();
                w.WriteString("access", k.Access);
                if (k.Refresh != null) w.WriteString("refresh", k.Refresh);
                w.WriteString("ends", k.Ends.ToString("o"));
                w.WriteString("name", k.Name ?? "");
                w.WriteBoolean("premium", k.Premium);
                w.WriteEndObject();
            }
            lock (gate)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(KeptFile));
                    File.WriteAllText(KeptFile, Seal(Encoding.UTF8.GetString(ms.ToArray())));
                    Secrets.LockDown(KeptFile);
                }
                catch (Exception ex) { throw new ModlistStop("The Nexus sign in could not be kept: " + Failure.Why("Nexus.Write", ex, KeptFile) + "."); }
            }
        }

        static Kept Read()
        {
            string text;
            lock (gate)
            {
                try { text = File.Exists(KeptFile) ? Unseal(File.ReadAllText(KeptFile).Trim()) : ""; }
                catch (Exception ex)
                {
                    // Nothing to sign in with; Sign in to Nexus asks again.
                    Swallow.Note("Nexus.Read", ex);
                    return null;
                }
            }
            if (text.Length == 0) return null;
            try
            {
                using (JsonDocument d = JsonDocument.Parse(text))
                {
                    JsonElement r = d.RootElement;
                    DateTime ends;
                    if (string.IsNullOrEmpty(Str(r, "access")) || !DateTime.TryParse(Str(r, "ends"), null, System.Globalization.DateTimeStyles.RoundtripKind, out ends)) return null;
                    return new Kept
                    {
                        Access = Str(r, "access"),
                        Refresh = Str(r, "refresh"),
                        Ends = ends,
                        Name = Str(r, "name") ?? "",
                        Premium = r.TryGetProperty("premium", out JsonElement p) && p.ValueKind == JsonValueKind.True,
                    };
                }
            }
            catch (JsonException ex)
            {
                Swallow.Note("Nexus.Read, Profile\\nexus.txt is not what Write writes", ex);
                return null;
            }
        }

        /// <summary>
        /// The access token, renewed first when it ends within a minute.
        /// Throws ModlistStop when nobody is signed in or Nexus would not
        /// renew it, which means signing in again.
        /// </summary>
        internal static string Token()
        {
            Kept k = Read();
            if (k == null) throw new ModlistStop("Nobody is signed in to Nexus here. Press Sign in to Nexus.");
            if (k.Ends > DateTime.UtcNow.AddMinutes(1)) return k.Access;
            if (string.IsNullOrEmpty(k.Refresh)) throw new ModlistStop("The Nexus sign in has run out. Press Sign in to Nexus again.");
            Kept n = Trade(new[] { "grant_type", "refresh_token", "client_id", ClientId, "refresh_token", k.Refresh }, k,
                           "The Nexus sign in has run out and Nexus would not renew it, so press Sign in to Nexus again. Nexus said: ");
            Write(n);
            return n.Access;
        }

        /// <summary>
        /// Downloads the modlist's Nexus file <paramref name="a"/> into
        /// <paramref name="downloads"/> under its own name, through Nexus's
        /// API, for a Premium account: the link Nexus gives, then the file,
        /// held to the modlist's size and xxHash64 before it takes the name.
        /// Throws ModlistStop with the reason, and leaves nothing under the
        /// name when it did not hold.
        /// </summary>
        public static void Download(ModlistArchive a, string downloads, Action<long> onBytes)
        {
            if (a == null || a.Kind != "nexus") throw new ModlistStop("Only a Nexus file of the modlist is downloaded from Nexus.");
            Account who = Who;
            if (who == null) throw new ModlistStop("Nobody is signed in to Nexus here. Press Sign in to Nexus, or download " + a.Say() + " with Manual Download.");
            if (!who.Premium) throw new ModlistStop("Nexus gives files straight to a Premium account only, so " + a.Say() + " is downloaded with Manual Download.");
            string link;
            HttpRequestMessage req = Request(HttpMethod.Get, Api + "/games/skyrimspecialedition/mods/" + a.ModId + "/files/" + a.FileId + "/download_link.json");
            req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + Token());
            try
            {
                using (JsonDocument d = Json(req, "the link for " + a.Say()))
                {
                    JsonElement r = d.RootElement;
                    link = r.ValueKind == JsonValueKind.Array && r.GetArrayLength() > 0 ? Str(r[0], "URI") : null;
                }
            }
            catch (Exception ex) { throw new ModlistStop("Nexus gave no link for " + a.Say() + ": " + Failure.Why("Nexus.Download, the link", ex) + "."); }
            Uri u;
            if (string.IsNullOrEmpty(link) || !Uri.TryCreate(link, UriKind.Absolute, out u) || (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp))
                throw new ModlistStop("Nexus gave no link for " + a.Say() + ".");

            Directory.CreateDirectory(downloads);
            string to = Path.Combine(downloads, a.Name);
            string got = to + ".got";
            try
            {
                try
                {
                    using (HttpRequestMessage file = Request(HttpMethod.Get, link))
                    using (HttpResponseMessage res = Http.Send(file, AnswerMs))
                    {
                        if (!res.IsSuccessStatusCode) throw new ModlistStop(a.Say() + " was not downloaded: Nexus's file server answered " + (int)res.StatusCode + " " + res.ReasonPhrase + ".");
                        using (var fs = new FileStream(got, FileMode.Create, FileAccess.Write, FileShare.None))
                            Http.CopyBody(res, fs, Http.DefaultReadMs, onBytes);
                    }
                }
                catch (ModlistStop) { throw; }
                catch (Exception ex) { throw new ModlistStop(a.Say() + " could not be downloaded from Nexus: " + Failure.Why("Nexus.Download, " + a.Name, ex, got) + "."); }
                if (new FileInfo(got).Length != a.Size || XxHash64.OfFile(got) != a.Hash)
                    throw new ModlistStop(a.Say() + " arrived from Nexus, and is not the file the modlist names, so it was not kept.");
                File.Move(got, to, true);
            }
            finally { if (File.Exists(got)) File.Delete(got); }
        }
    }
}
