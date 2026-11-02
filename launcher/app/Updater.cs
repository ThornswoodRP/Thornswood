using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;

namespace Thornswood
{
    static partial class Updater
    {
        // The launcher's number, the one the build gave the exe (#4825): the
        // build passes it as -p:Version (scripts\release\Build-Launcher.ps1),
        // and in a merge release it is the version of the Velopack package
        // the exe goes out in (merge-release.yml, MergeRelease.ps1), so the
        // launcher, the package and the signed release record say the same
        // number. A bare build says 0.0.0. Until #4825 the build wrote the
        // number into this line and put it back afterwards; nothing writes a
        // source file for the build any more.
        public static readonly string Version = BuiltVersion();

        /// <summary>
        /// The exe's own version, three parts, or four when the build gave
        /// four (a dev Ship's number, Ship.ps1). Read from the assembly's name,
        /// which the native build keeps.
        /// </summary>
        static string BuiltVersion()
        {
            System.Version v = typeof(Updater).Assembly.GetName().Version;
            if (v == null) return "0.0.0";
            string three = v.Major + "." + v.Minor + "." + Math.Max(0, v.Build);
            return v.Revision > 0 ? three + "." + v.Revision : three;
        }

        /// <summary>
        /// The collection revision the last feed named, or 0 when it named
        /// none. Set by OnVersionDoc as the document arrives, so anything that
        /// asks after that is asking about the release that is actually live.
        ///
        /// Held here rather than in Config because it is not a setting: it is
        /// a fact about the server, and writing it into config.json would mean
        /// a stale copy outliving the release it came from.
        /// </summary>
        public static int FeedCollectionRevision;

        /// <summary>
        /// The address the last check actually read version.json from, so
        /// launcher.log can be read back afterwards and say where the checks
        /// went: the site feed on thornswood.net, the only source since #907.
        /// </summary>
        public static string LastFeedUrl = "";

        /// <summary>
        /// True when the last check was answered out of the cache below
        /// because the feed said nothing had changed, so nothing was
        /// downloaded.
        /// </summary>
        public static bool LastNotModified;

        /// <summary>
        /// One answer from the site feed: the document, the ETag it arrived
        /// with, and the address it came from. All three together, in one
        /// object that is never edited after it is built, because a check from
        /// the timer and a check somebody pressed can be in flight at the same
        /// time. Three separate fields could be left holding one check's tag
        /// beside another's document, and a launcher asking with a tag that
        /// does not belong to the copy it holds would be told nothing had
        /// changed and go on believing an older feed.
        /// </summary>
        class Cached
        {
            public string Url;
            public string Etag;
            public string LastModified;
            public VersionDoc Doc;
        }

        // The last answer the site feed gave.
        //
        // While somebody plays, Check runs every thirty seconds, because the
        // countdown that closes the game has to land inside the server's five
        // minute window (Shell.CheckUpdatesInPlay). The document is around
        // ninety kilobytes and only changes when somebody ships, so that was
        // ten megabytes an hour per launcher to be told the same thing. With
        // the tag on the next request the site answers 304 and no body.
        //
        // Not in config.json on purpose: the tag is worth nothing without the
        // document it belongs to, and a config that kept the tag alone would
        // start up, ask with it, be told nothing had changed, and have nothing
        // to read. So the tag and the document are kept together, in memory
        // and in one file in Profile (CacheFile, #443), and the file is only
        // believed when the document in it still reads. Before the file, every
        // start of the launcher downloaded the whole feed again.
        static Cached cached;
        static bool cacheRead;
        const string CacheMagic = "Thornswood feed cache 1";

        // The feed's requests go through Http.cs, the launcher's one HttpClient
        // (#4823, #4825), with ten seconds for the answer to start, so a GitHub
        // or a site that accepts the connection and then says nothing does not
        // look like a hung launcher. The wait is for the answer, not the body:
        // a large asset still downloads for as long as its bytes keep coming
        // (Http.cs, readMs). Until then they went through a WebClient of their
        // own, Quick, with the same ten seconds.
        const int AnswerMs = 10000;

        /// <summary>
        /// A GET with the launcher's headers. The token only ever goes to
        /// GitHub's own API, never to whatever host an asset URL happens to
        /// point at. gzip asks for the answer compressed, for the feed's JSON
        /// only (#443): a compressed feed is a quarter of the size, and
        /// FeedBody reads it either way.
        /// </summary>
        static HttpRequestMessage FeedAsk(Config cfg, bool octet, string url, bool gzip)
        {
            var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.TryAddWithoutValidation("User-Agent", "ThornswoodLauncher/" + Version);
            bool github = false;
            try { github = new Uri(url).Host.Equals("api.github.com", StringComparison.OrdinalIgnoreCase); }
            catch (Exception ex) { Swallow.Note("Updater.FeedAsk, uri host", ex); }
            if (github && !string.IsNullOrEmpty(cfg.UpdateToken))
                req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + cfg.UpdateToken);
            // GitHub Contents API wants the raw media type; a direct https feed
            // on thornswood.net is ordinary JSON (#649).
            string accept;
            if (github) accept = octet ? "application/octet-stream" : "application/vnd.github.raw";
            else accept = octet ? "application/octet-stream" : "application/json";
            req.Headers.TryAddWithoutValidation("Accept", accept);
            if (gzip) req.Headers.TryAddWithoutValidation("Accept-Encoding", "gzip");
            return req;
        }

        /// <summary>The answer's body, unpacked when the server sent it gzip.</summary>
        static byte[] FeedBody(HttpResponseMessage res, int readMs)
        {
            byte[] raw = Http.Body(res, readMs);
            foreach (string e in res.Content.Headers.ContentEncoding)
            {
                if (!string.Equals(e, "gzip", StringComparison.OrdinalIgnoreCase)) continue;
                using (var z = new GZipStream(new MemoryStream(raw), CompressionMode.Decompress))
                using (var ms = new MemoryStream())
                {
                    z.CopyTo(ms);
                    return ms.ToArray();
                }
            }
            return raw;
        }

        /// <summary>
        /// The body of a 2xx answer, and an exception for any other answer,
        /// worded as WebClient's DownloadData worded it, which is what the
        /// callers had before.
        /// </summary>
        static byte[] FeedGet(Config cfg, bool octet, string url, bool gzip = false)
        {
            using (HttpRequestMessage req = FeedAsk(cfg, octet, url, gzip))
            using (HttpResponseMessage res = Http.Send(req, AnswerMs))
            {
                if (!res.IsSuccessStatusCode) throw Refused(res);
                return FeedBody(res, Http.DefaultReadMs);
            }
        }

        static HttpRequestException Refused(HttpResponseMessage res)
        {
            return new HttpRequestException("The remote server returned an error: (" + (int)res.StatusCode + ") " + res.ReasonPhrase + ".", null, res.StatusCode);
        }

        /// <summary>One header of the answer, from either of its two lists, or null.</summary>
        static string HeaderOf(HttpResponseMessage res, string name)
        {
            IEnumerable<string> v;
            if (res.Headers.TryGetValues(name, out v) || res.Content.Headers.TryGetValues(name, out v))
                return string.Join(", ", v);
            return null;
        }

        /// <summary>The feed this build reads when config.json names none of Thornswood's.</summary>
        public const string MainFeed = "https://thornswood.net/feed/version.json";
        public const string DevFeed = "https://thornswood.net/feed-dev/version.json";

        /// <summary>
        /// Where version.json is read from. Always somewhere: the update check
        /// cannot be switched off (#937).
        ///
        /// Until #937 an UpdateFeedUrl blanked or bent in config.json turned
        /// the check off, and a launcher with no update source let Play through
        /// on its own say (Unblock, gone with this). So an out of date
        /// launcher was one edit away from playing. Now config.json may only
        /// move the feed within thornswood.net, over https, the way a feed
        /// announces a move (updateFeedUrl); anything else, empty included, is
        /// the built-in address for this build's channel. A feed address that
        /// then does not answer keeps Play shut like any other failed check,
        /// and a dev build pointed at the main feed gets no join pass from the
        /// site, which checks the launcher against its own channel's feed.
        /// </summary>
        public static string FeedUrl(Config cfg)
        {
            bool dev = cfg != null &&
                       (string.Equals(cfg.Channel, "dev", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(cfg.UpdateBranch, "dev", StringComparison.OrdinalIgnoreCase));
            string builtIn = dev ? DevFeed : MainFeed;
            string said = (cfg == null || cfg.UpdateFeedUrl == null) ? "" : cfg.UpdateFeedUrl.Trim();
            Uri u;
            if (said.Length == 0 || !Uri.TryCreate(said, UriKind.Absolute, out u)) return builtIn;
            if (u.Scheme != Uri.UriSchemeHttps || !u.IsDefaultPort || u.UserInfo.Length > 0) return builtIn;
            string host = u.Host.ToLowerInvariant();
            if (host != "thornswood.net" && !host.EndsWith(".thornswood.net", StringComparison.Ordinal)) return builtIn;
            // A feed may move within its own channel, never across it (Djinn,
            // 2 Oct). The dev feed shipped updateFeedUrl = the main feed on
            // 1 Oct, every dev launcher saved it, and from then on read the
            // main feed: no dev launcher update, no dev client, and Play shut
            // for good on a Client row nothing could put right. A dev build
            // reads a feed-dev address or its built-in one, and a main build
            // never reads feed-dev.
            bool saysDev = u.AbsolutePath.IndexOf("/feed-dev/", StringComparison.OrdinalIgnoreCase) >= 0;
            if (saysDev != dev) return builtIn;
            return said;
        }

        /// <summary>
        /// True only when the published launcher is genuinely newer than the
        /// one running.
        ///
        /// This used to be a plain "different from mine" test, and different
        /// includes older. So a machine that had just built a launcher would
        /// open it, see an older number in the release, call that an update,
        /// and overwrite the build it had just made with the one it replaced.
        /// It looks exactly like the build silently not happening, and the
        /// person who did the building is the only one it can happen to.
        /// </summary>
        public static bool IsNewer(string remote, string local)
        {
            if (string.IsNullOrEmpty(remote)) return false;
            if (string.IsNullOrEmpty(local)) return true;
            if (string.Equals(remote, local, StringComparison.OrdinalIgnoreCase)) return false;

            int[] a = Parts(remote), b = Parts(local);
            if (a == null || b == null)
            {
                // Either side did not parse as dotted integers. A different
                // string is not proof that the remote is newer, so an older
                // unreadable version is not an update.
                return false;
            }
            int n = Math.Max(a.Length, b.Length);
            for (int i = 0; i < n; i++)
            {
                int x = i < a.Length ? a[i] : 0;
                int y = i < b.Length ? b[i] : 0;
                if (x != y) return x > y;
            }
            return false;
        }

        static int[] Parts(string v)
        {
            try
            {
                string[] bits = v.Trim().TrimStart('v', 'V').Split('.');
                var o = new int[bits.Length];
                for (int i = 0; i < bits.Length; i++)
                {
                    if (!int.TryParse(bits[i], out o[i])) return null;
                }
                return o;
            }
            catch { return null; }
        }

        /// <summary>
        /// Reads version.json from FeedUrl (direct https on the site, #649),
        /// with the ETag of the last copy so an unchanged feed is answered 304
        /// and not downloaded again. Until #907 a miss fell back to the GitHub
        /// Contents API on UpdateRepo (Thornswood-Releases); that repository is
        /// gone, so a miss throws and the next check tries the site again.
        /// Never null: updates cannot be off (#937).
        /// </summary>
        public static VersionDoc Check(Config cfg)
        {
            // No line setting the security protocol any more (#4825). On
            // the .NET Framework it added TLS 1.2 to an old default (#1360). On
            // .NET 10 the default is whatever Windows allows, TLS 1.3 included,
            // and adding TLS 1.2 to that default would have turned it into TLS
            // 1.2 alone.
            LastNotModified = false;

            string feedUrl = FeedUrl(cfg);
            LastFeedUrl = feedUrl;
            // No GitHub fallback any more (#907): Thornswood-Releases is gone.
            // A site feed that misses is what the caller gets, which reads as
            // no answer rather than as no update, so the in play clock is left
            // where it is (Shell.CheckUpdatesInPlay) and the next check, thirty
            // seconds on, asks the site again.
            try { return FromSite(cfg, feedUrl); }
            catch (Exception ex) { throw WrapFeedFail(ex, true); }
        }

        /// <summary>
        /// The long-poll tip beside version.json (#2440). Same host and channel
        /// as FeedUrl: /feed/watch or /feed-dev/watch. A launcher keeps one of
        /// these open so a Ship is seen without restarting or pressing Check now.
        /// </summary>
        public static string WatchUrl(Config cfg)
        {
            string feed = FeedUrl(cfg);
            const string leaf = "/version.json";
            if (feed.EndsWith(leaf, StringComparison.OrdinalIgnoreCase))
                return feed.Substring(0, feed.Length - leaf.Length) + "/watch";
            // FeedUrl always ends in version.json today; if a moved feed uses
            // another leaf, tip at the same folder.
            int slash = feed.LastIndexOf('/');
            if (slash > 0) return feed.Substring(0, slash) + "/watch";
            return feed + "/watch";
        }

        /// <summary>
        /// Long-poll /feed/watch with the ETag of the copy already in hand
        /// (#2440). True when the tip says the feed moved (HTTP 200); false
        /// when the wait ran out unchanged (HTTP 204). Throws when the tip
        /// cannot be reached, gives no answer in time, or answers anything
        /// else, so the caller says so in launcher.log and backs off.
        /// </summary>
        public static bool WaitForFeedChange(Config cfg)
        {
            string tip = WatchUrl(cfg);
            CheckUrl(tip);

            Cached have = cached;
            if (have == null && !cacheRead)
            {
                cacheRead = true;
                have = ReadCache();
                if (have != null) cached = have;
            }
            string tag = "";
            if (have != null && !string.IsNullOrEmpty(have.Etag)
                && string.Equals(have.Url, FeedUrl(cfg), StringComparison.Ordinal))
                tag = have.Etag.Trim();

            // The tip holds the socket for fifty seconds on the site and then
            // answers 204 (measured 18 Oct: 204 after 50.7 s). Sixty here, so
            // the site's own answer always arrives first; the feed's usual ten
            // (AnswerMs) would cut every quiet wait off before the site could
            // answer.
            return Tip(cfg, tip, tag, 60000);
        }

        // THE WATCH'S OWN CONNECTION (#2440, WatchGroup until #4823). The .NET
        // Framework let a program keep two connections to a host at a time,
        // and the watch, holding one all the time, left the Play page's
        // gallery, pictures, voice token and news to take turns on the other,
        // so it was given a connection group of its own. On .NET 10 the
        // shared HttpClient (Http.cs) has no such limit: SocketsHttpHandler's
        // MaxConnectionsPerServer is unlimited unless set, and Http.cs does
        // not set it, so the watch's open request holds no other back and
        // needs no group.

        /// <summary>
        /// The long-poll request itself, apart from CheckUrl so a test can
        /// point it at a server of its own (launcher\tests\test-2636-feed-watch-quiet.ps1),
        /// the way Conditional is apart from FromSite.
        ///
        /// The site answers 200 when the feed moved and 204 when its wait ran
        /// out unchanged. WebClient treated every 2xx as success: DownloadData
        /// returned for a 204 with an empty array and never threw. Until #2636
        /// this read any return from DownloadData as "moved" and looked for the
        /// 204 in the catch, where it never arrives, so every quiet fifty
        /// second wait ran a full update check, about seventy an hour for each
        /// open launcher (Djinn's launcher.log, 17 Oct). The status is read
        /// off the answer instead. A client timeout used to be read as
        /// "unchanged" too; the site always answers inside the wait, so no
        /// answer is a fault, and it now throws like any other.
        /// </summary>
        static bool Tip(Config cfg, string tip, string tag, int ms)
        {
            using (HttpRequestMessage req = FeedAsk(cfg, false, tip, true))
            {
                if (tag.Length > 0) req.Headers.TryAddWithoutValidation("If-None-Match", tag);
                HttpResponseMessage res;
                try { res = Http.Send(req, ms); }
                catch (Exception ex) when (ex is HttpRequestException || ex is TimeoutException) { throw WrapFeedFail(ex, true); }
                using (res)
                {
                    // Anything but 2xx failed, as it did when WebClient threw.
                    if (!res.IsSuccessStatusCode) throw WrapFeedFail(Refused(res), true);
                    int status = (int)res.StatusCode;
                    // 200: the feed moved, or there was no tag to compare.
                    if (status == 200) return true;
                    // 204: the wait ran out and the feed is as it was.
                    if (status == 204) return false;
                    throw new Exception("The update feed tip answered HTTP " + status + ", which says neither that the feed moved nor that it did not.");
                }
            }
        }
        /// <summary>
        /// version.json straight off the site feed, asking with the ETag of the
        /// copy already in hand so an unchanged document is not downloaded
        /// again (#445). The answer is the same VersionDoc either way, so
        /// nothing above here has to know which of the two it got.
        /// </summary>
        static VersionDoc FromSite(Config cfg, string feedUrl)
        {
            CheckUrl(feedUrl);
            return Conditional(cfg, feedUrl);
        }

        /// <summary>
        /// The conditional request itself, apart from CheckUrl so a test can
        /// point it at a server of its own (launcher\tests\test-feed-conditional.ps1).
        /// Asks with the ETag, and with Last-Modified when the server gave one,
        /// of the copy in memory, or on the first check of a session the copy
        /// in Profile (#443), so a restart is a 304 too.
        /// </summary>
        static VersionDoc Conditional(Config cfg, string feedUrl)
        {
            // Read once. Anything that replaces it while this check is out
            // replaces the whole object, so what is used below cannot change
            // underneath it.
            Cached have = cached;
            if (have == null && !cacheRead)
            {
                cacheRead = true;
                have = ReadCache();
                if (have != null) cached = have;
            }
            DateTime since = DateTime.MinValue;
            if (have != null && !string.IsNullOrEmpty(have.LastModified))
            {
                DateTime t;
                if (DateTime.TryParseExact(have.LastModified.Trim(), "r", System.Globalization.CultureInfo.InvariantCulture,
                        System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out t))
                    since = t;
            }
            bool asked = have != null
                         && have.Doc != null
                         && (!string.IsNullOrEmpty(have.Etag) || since != DateTime.MinValue)
                         && string.Equals(have.Url, feedUrl, StringComparison.Ordinal);
            using (HttpRequestMessage req = FeedAsk(cfg, false, feedUrl, true))
            {
                if (asked && !string.IsNullOrEmpty(have.Etag)) req.Headers.TryAddWithoutValidation("If-None-Match", have.Etag);
                if (asked && since != DateTime.MinValue) req.Headers.IfModifiedSince = new DateTimeOffset(since, TimeSpan.Zero);
                using (HttpResponseMessage res = Http.Send(req, AnswerMs))
                {
                    // The one reply this cache exists to get. HttpClient hands a
                    // 304 back as an answer; the .NET Framework's WebClient threw
                    // it as a WebException, and an empty 2xx was read as one too
                    // in case some stack answered that way. Only a real 304 is
                    // one now; anything else that is not 2xx is a failed check
                    // and goes on up.
                    if (asked && (int)res.StatusCode == 304)
                    {
                        LastNotModified = true;
                        return have.Doc;
                    }
                    if (!res.IsSuccessStatusCode) throw Refused(res);
                    byte[] body = FeedBody(res, Http.DefaultReadMs);
                    VersionDoc doc = ReadFeed(body, feedUrl, cfg);
                    // Kept only once the document parsed, so a tag is never held
                    // beside something the launcher could not read.
                    string tag = HeaderOf(res, "ETag"), mod = HeaderOf(res, "Last-Modified");
                    var fresh = new Cached();
                    fresh.Url = feedUrl;
                    fresh.Etag = tag == null ? "" : tag.Trim();
                    fresh.LastModified = mod == null ? "" : mod.Trim();
                    fresh.Doc = doc;
                    cached = fresh;
                    if (fresh.Etag.Length > 0 || fresh.LastModified.Length > 0) WriteCache(fresh, body);
                    return doc;
                }
            }
        }

        /// <summary>
        /// Profile\feed-cache.txt: four lines (what the file is, the feed
        /// address, the ETag, the Last-Modified) and then the document exactly
        /// as it arrived. One file, so the tag can never be read beside some
        /// other copy's document. Null when Profile is not known.
        /// </summary>
        static string CacheFile
        {
            get { return string.IsNullOrEmpty(Paths.ProfileDir) ? null : Path.Combine(Paths.ProfileDir, "feed-cache.txt"); }
        }

        static void WriteCache(Cached c, byte[] body)
        {
            string file = CacheFile;
            if (file == null || body == null) return;
            string tmp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                byte[] head = new UTF8Encoding(false).GetBytes(
                    CacheMagic + "\n" + OneLine(c.Url) + "\n" + OneLine(c.Etag) + "\n" + OneLine(c.LastModified) + "\n");
                using (var f = File.Create(tmp))
                {
                    f.Write(head, 0, head.Length);
                    f.Write(body, 0, body.Length);
                }
                // Written aside and copied over, so a check that reads while
                // another writes finds the old copy or the new one, and a
                // copy cut short does not parse and is not believed.
                File.Copy(tmp, file, true);
            }
            catch (Exception ex) { Swallow.Note("Updater.WriteCache", ex); }
            finally
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch (Exception ex) { Swallow.Note("Updater.WriteCache, tidy", ex); }
            }
        }

        static string OneLine(string s)
        {
            return s == null ? "" : s.Replace("\r", "").Replace("\n", "");
        }

        /// <summary>
        /// The copy in Profile, or null when there is none, it is from an older
        /// shape, or its document does not read. Null only ever costs one full
        /// download, which is what every start of the launcher did before.
        /// </summary>
        static Cached ReadCache()
        {
            string file = CacheFile;
            try
            {
                if (file == null || !File.Exists(file)) return null;
                byte[] raw = File.ReadAllBytes(file);
                var lines = new string[4];
                int at = 0;
                for (int i = 0; i < 4; i++)
                {
                    int nl = Array.IndexOf(raw, (byte)'\n', at);
                    if (nl < 0) return null;
                    lines[i] = Encoding.UTF8.GetString(raw, at, nl - at).TrimEnd('\r');
                    at = nl + 1;
                }
                if (!string.Equals(lines[0], CacheMagic, StringComparison.Ordinal)) return null;
                if (at >= raw.Length) return null;
                byte[] body = new byte[raw.Length - at];
                Buffer.BlockCopy(raw, at, body, 0, body.Length);
                // The settings file it names only from memory or Profile: a
                // copy without them costs one full check, never a download here.
                VersionDoc doc = ReadFeed(body, lines[1], null);
                if (doc == null) return null;
                var c = new Cached();
                c.Url = lines[1];
                c.Etag = lines[2];
                c.LastModified = lines[3];
                c.Doc = doc;
                return c;
            }
            catch (Exception ex)
            {
                Swallow.Note("Updater.ReadCache", ex);
                return null;
            }
        }

        static Exception WrapFeedFail(Exception ex, bool fromHost)
        {
            string where = fromHost ? "the site update feed" : "GitHub";
            // Http.Send and its reads throw TimeoutException when the answer
            // or the next bytes of it did not come in time.
            if (ex is TimeoutException)
                return new Exception(where + " did not answer in time. The check runs again by itself.");
            if (!string.IsNullOrEmpty(ex.Message)
                && (ex.Message.StartsWith("the ", StringComparison.Ordinal)
                    || ex.Message.StartsWith("GitHub ", StringComparison.Ordinal)
                    || ex.Message.StartsWith("The update feed", StringComparison.Ordinal)))
                return ex;
            return new Exception("could not reach " + where);
        }

        public static HashSet<string> Applied()
        {
            var s = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try { if (File.Exists(Paths.AppliedFile)) foreach (string l in File.ReadAllLines(Paths.AppliedFile)) if (l.Trim().Length > 0) s.Add(l.Trim()); }
            catch (Exception ex) { Swallow.Note("Updater.Applied, read", ex); }
            return s;
        }

        /// <summary>
        /// Write a pack off without applying it. For one that cannot be
        /// downloaded at all, so it stops being offered on every check.
        /// </summary>
        public static void Skip(string id)
        {
            if (string.IsNullOrEmpty(id)) return;
            MarkApplied(id);
        }

        static void MarkApplied(string id)
        {
            try { File.AppendAllText(Paths.AppliedFile, id + Environment.NewLine); } catch (Exception ex) { Swallow.Note("Updater.MarkApplied, append", ex); }
        }

        /// <summary>
        /// Take a pack back out of applied.txt.
        ///
        /// The file was append only, which was fine while every pack was a
        /// required update that only ever went on. An optional pack can come
        /// off again, and a line that cannot be removed means the launcher
        /// would go on believing it was installed forever.
        /// </summary>
        static void Unapply(string id)
        {
            try
            {
                if (!File.Exists(Paths.AppliedFile)) return;
                var keep = new List<string>();
                foreach (string l in File.ReadAllLines(Paths.AppliedFile))
                {
                    string t = l.Trim();
                    if (t.Length == 0) continue;
                    if (string.Equals(t, id, StringComparison.OrdinalIgnoreCase)) continue;
                    keep.Add(t);
                }
                File.WriteAllLines(Paths.AppliedFile, keep.ToArray());
            }
            catch (Exception ex) { Swallow.Note("Updater.Unapply, write", ex); }
        }

        /// <summary>True if this pack is on disk right now.</summary>
        public static bool IsInstalled(string id)
        {
            return !string.IsNullOrEmpty(id) && Applied().Contains(id);
        }


        static string PackListFile(string id)
        {
            var clean = new StringBuilder();
            foreach (char c in id)
                clean.Append(Array.IndexOf(Path.GetInvalidFileNameChars(), c) >= 0 ? '_' : c);
            return Path.Combine(Paths.PacksDir, clean.ToString() + ".files");
        }

        /// <summary>
        /// Every path some other pack's file list still claims, in the shape
        /// the lists hold them: a game\ prefix for a game path, nothing for a
        /// Root one.
        ///
        /// Ownership is recorded per pack and not per file. When a later pack
        /// writes over a file an earlier one created, the later list says "R|"
        /// because the file was already there and the earlier one still says
        /// "N|". Taking the earlier pack off then deleted the file the later
        /// one is using, and what somebody saw was a build missing part of an
        /// add-on they had not touched.
        /// </summary>
        static HashSet<string> ClaimedElsewhere(string mine)
        {
            var s = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string leaf = "";
            try { leaf = Path.GetFileName(mine); } catch (Exception ex) { Swallow.Note("Updater.ClaimedElsewhere, leaf", ex); }
            try
            {
                if (!Directory.Exists(Paths.PacksDir)) return s;
                foreach (string f in Directory.GetFiles(Paths.PacksDir, "*.files"))
                {
                    if (string.Equals(Path.GetFileName(f), leaf, StringComparison.OrdinalIgnoreCase)) continue;
                    string[] all;
                    try { all = File.ReadAllLines(f); }
                    catch { continue; }
                    foreach (string raw in all)
                    {
                        string line = raw.Trim();
                        if (line.Length < 3 || line[1] != '|') continue;
                        s.Add(line.Substring(2));
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("Updater.ClaimedElsewhere", ex); }
            return s;
        }

        /// <summary>
        /// Every path Vortex says it has deployed into the game folder. Under
        /// a folder of Thornswood's own the record lives in the folder Vortex
        /// deploys into (OwnGame.DeploysInto), never in Thornswood's folder,
        /// because the refresh leaves Vortex's own records behind. That is the
        /// Steam copy, unless Vortex deploys into another folder, and then the
        /// record is there and not in the Steam copy (OwnGame.Source), which is
        /// why this does not read Source (review, 24 September). Empty when
        /// there is nothing to read, which leaves the removal as it was.
        /// </summary>
        static HashSet<string> DeployedNow(Config cfg)
        {
            try
            {
                string src = OwnGame.Active ? OwnGame.DeploysInto(cfg) : Paths.Game;
                if (string.IsNullOrEmpty(src)) return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                return OwnGame.DeployedIn(src);
            }
            catch { return new HashSet<string>(StringComparer.OrdinalIgnoreCase); }
        }

        /// <summary>
        /// What this install still has to take from the feed. When the feed
        /// names a release record this install has not synced to, that is one
        /// entry standing for the whole release (Sync.cs, #1050), and no pack
        /// is replayed. Otherwise every pack id not in applied.txt, in order.
        /// Nothing on dev, where the game files come with the launcher's
        /// Velopack package (Velo.GameFromPackage, SyncPackage.cs).
        /// </summary>
        public static List<Pack> Pending(Config cfg, VersionDoc v)
        {
            var list = new List<Pack>();
            if (Velo.GameFromPackage(cfg)) return list;
            Pack release = RecordDue(cfg, v);
            if (release != null) { list.Add(release); return list; }
            var done = Applied();
            if (v == null || v.packs == null) return list;
            foreach (var p in v.packs)
                if (p != null && !string.IsNullOrEmpty(p.id) && !done.Contains(p.id)) list.Add(p);
            return list;
        }

        static string Sha256(string file)
        {
            using (var s = File.OpenRead(file))
            using (var h = SHA256.Create())
            {
                byte[] d = h.ComputeHash(s);
                var sb = new StringBuilder();
                foreach (byte b in d) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        /// <summary>
        /// Where an update is allowed to come from. version.json is a file we
        /// write, but it is also a file somebody else could write if they ever
        /// got at the repository, and the thing on the other end of this url
        /// gets executed on somebody's machine. So the url is checked against
        /// this list before a single byte is fetched.
        /// </summary>
        static readonly string[] AllowedHosts =
        {
            "github.com",
            "objects.githubusercontent.com",
            "release-assets.githubusercontent.com",
            "api.github.com",
            "thornswood.net"
        };

        static void CheckUrl(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u))
                throw new Exception("The update feed gave an address that is not an address. Nothing was downloaded.");
            if (u.Scheme != Uri.UriSchemeHttps)
                throw new Exception("The update feed asked for a download over plain http. Refused.");
            string h = u.Host.ToLowerInvariant();
            bool ok = false;
            foreach (string a in AllowedHosts)
                if (h == a || h.EndsWith("." + a, StringComparison.Ordinal)) { ok = true; break; }
            if (!ok)
                throw new Exception("The update feed pointed at " + u.Host + ", which is not where Thornswood updates come from. Refused.");
        }

        /// <summary>
        /// Download, for a caller that wants the zip and not the install.
        ///
        /// ClientRuntime.Heal takes the six recorded client files out of a pack
        /// WITHOUT applying it, because applying a pack twice writes applied.txt
        /// and a fresh file list in which every path reads as one that pack
        /// wrote over, which puts its own files out of reach of its own Remove.
        /// A repair must not move that bookkeeping. Every check Download makes
        /// is still made: the url is checked and the checksum is mandatory.
        /// </summary>
        public static string Fetch(Config cfg, string url, string expectSha, Action<string> log)
        {
            return Download(cfg, url, expectSha, log);
        }

        static string Download(Config cfg, string url, string expectSha, Action<string> log)
        {
            CheckUrl(url);

            // An update with no checksum used to be accepted quietly, which
            // meant one blank field in version.json was enough to run anything
            // on every machine. There is no such thing as an optional check on
            // a file that is about to be executed.
            if (string.IsNullOrEmpty(expectSha))
                throw new Exception("That update arrived without a checksum, so it has not been downloaded. This is a publishing mistake, not something wrong with your install.");

            string tmp = Path.Combine(Path.GetTempPath(), "thornswood-" + Guid.NewGuid().ToString("N") + ".bin");
            // Read in pieces rather than DownloadFile, so the Play button can
            // show the bytes as they come (#1145, PlayProgress.Part).
            try
            {
                using (HttpRequestMessage req = FeedAsk(cfg, true, url, false))
                using (HttpResponseMessage res = Http.Send(req, AnswerMs))
                {
                    if (!res.IsSuccessStatusCode) throw Refused(res);
                    long length = res.Content.Headers.ContentLength ?? -1;
                    PlayProgress.Part(0, length);
                    using (var f = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
                        Http.CopyBody(res, f, Http.DefaultReadMs, had => PlayProgress.Part(had, length));
                }
            }
            catch
            {
                try { File.Delete(tmp); } catch (Exception ex) { Swallow.Note("Updater.Download, delete part", ex); }
                throw;
            }
            PlayProgress.PartDone();

            string got = Sha256(tmp);
            if (!string.Equals(got, expectSha, StringComparison.OrdinalIgnoreCase))
            {
                try { File.Delete(tmp); } catch (Exception ex) { Swallow.Note("Updater.Download, delete", ex); }
                throw new Exception("Checksum did not match. Download rejected.");
            }
            log("Checksum verified.");
            return tmp;
        }

        /// <summary>
        /// First line of every file list written since the fence below was
        /// fixed. A list without it was written by a launcher that could not
        /// put anything into a Steam copy of the game, and Requeue reads that
        /// as "apply this pack again".
        /// </summary>
        const string ListHeader = "# fence=game";

        /// <summary>Prefix on a list line whose path is under the game folder
        /// rather than under Root. Root relative lines carry no prefix.</summary>
        const string GameMark = "game\\";

        /// <summary>
        /// A pack is a zip holding game/ and profile/ trees, plus an optional
        /// delete.txt listing paths under Game to remove.
        ///
        /// Two fences, one per tree. The check used to be Inside(full, Root)
        /// for every entry, which is right for the profile tree and was right
        /// for the game tree while the game was Root\Game. On a collection
        /// install the game is the Steam copy, which is nowhere near Root, so
        /// every game\ entry failed the test and was skipped in silence. The
        /// pack was then marked applied and logged as "applied, 2 files": the
        /// two profile files, and not one file of the actual update. Every
        /// pack published for the collection build did this on every machine
        /// until 1.1.32.
        /// </summary>
        public static void ApplyPack(Config cfg, Pack p, Action<string> log)
        {
            // A whole release, synced to its record rather than unpacked.
            if (p != null && p.Record != null) { SyncRecord(cfg, p.Record, p.Doc, log); return; }
            // A retry runs the whole list again and everything before the pack
            // that broke is already in. A second helping means another line in
            // applied.txt and a file list written afresh in which every path
            // reads as one this pack wrote over, which puts the pack's own
            // files out of reach of its own Remove.
            if (IsInstalled(p.id)) { log(p.id + " is already in."); return; }
            log("Downloading " + p.id + "...");
            string zip = Download(cfg, p.url, p.sha256, log);
            try { Install(zip, p, log); }
            finally { try { File.Delete(zip); } catch (Exception ex) { Swallow.Note("Updater.ApplyPack, delete", ex); } }
        }

        /// <summary>The part of ApplyPack after the download: unpack the zip
        /// into place and record what it did. Separate so it can be exercised
        /// on a zip that never came from the feed.</summary>
        public static void Install(string zip, Pack p, Action<string> log)
        {
            {
                int files = 0;
                var wrote = new List<string>();
                wrote.Add(ListHeader);
                var newInGame = new List<string>();
                var gameWritten = new List<string>();
                var removed = new List<string>();
                // Whether this pack carried a reference plugin list, so it can
                // be settled into the live location once the pack is out.
                bool carriedProfile = false;
                using (var ar = ZipFile.OpenRead(zip))
                {
                    var del = ar.GetEntry("delete.txt");
                    if (del != null)
                    {
                        using (var sr = new StreamReader(del.Open()))
                        {
                            string line;
                            while ((line = sr.ReadLine()) != null)
                            {
                                line = line.Trim();
                                if (line.Length == 0 || line.StartsWith("#")) continue;
                                string rel = line.Replace('/', '\\');
                                string target;
                                // Fenced after the path is resolved, not
                                // before. Combine leaves the .. in a line like
                                // ..\..\Profile\x where it is, so the path
                                // still begins with the game folder as text,
                                // passes the test, and Delete is what resolves
                                // it, outside the game.
                                try { target = Path.GetFullPath(Path.Combine(Paths.Game, rel)); }
                                catch { continue; }
                                if (!PathFence.Inside(target, Paths.Game)) continue;
                                try { if (File.Exists(target)) { File.Delete(target); log("removed " + line); } } catch (Exception ex) { Swallow.Note("Updater.Install, delete", ex); }
                                removed.Add(rel);
                            }
                        }
                    }

                    foreach (var e in ar.Entries)
                    {
                        if (string.IsNullOrEmpty(e.Name)) continue;           // directory entry
                        string rel = e.FullName.Replace('/', '\\');
                        string dest = null;
                        bool inGame = false;

                        if (rel.StartsWith("game\\", StringComparison.OrdinalIgnoreCase))
                        {
                            dest = Path.Combine(Paths.Game, rel.Substring(5));
                            inGame = true;
                        }
                        else if (rel.StartsWith("profile\\", StringComparison.OrdinalIgnoreCase))
                        {
                            dest = Path.Combine(Paths.Golden, Path.GetFileName(rel));
                            string leaf = Path.GetFileName(rel);
                            if (leaf.Equals("plugins.txt", StringComparison.OrdinalIgnoreCase) ||
                                leaf.Equals("loadorder.txt", StringComparison.OrdinalIgnoreCase))
                                carriedProfile = true;
                        }
                        else if (rel.Equals("delete.txt", StringComparison.OrdinalIgnoreCase))
                            continue;
                        else if (rel.Equals("ui-assets.txt", StringComparison.OrdinalIgnoreCase))
                        {
                            // Hashed assets build.js named, written by Ship
                            // (#1318). OwnGame.Foreign reads this rather than
                            // parsing build.js.
                            try
                            {
                                string dir = Path.Combine(Paths.ProfileDir, "OwnGame");
                                Directory.CreateDirectory(dir);
                                dest = Path.Combine(dir, "ui-front-assets.txt");
                                e.ExtractToFile(dest, true);
                            }
                            catch (Exception ex) { Swallow.Note("Updater.Install, ui-assets", ex); }
                            continue;
                        }
                        else
                            continue;

                        // The fence is the folder the entry is meant for. A
                        // game entry has to land under the game, wherever the
                        // game is; a profile entry has to land under Root.
                        string full = Path.GetFullPath(dest);
                        string fence = inGame ? Paths.Game : Paths.Root;
                        if (!PathFence.Inside(full, fence)) continue;
                        Directory.CreateDirectory(Path.GetDirectoryName(full));

                        // Whether this file was already here decides whether
                        // taking the pack off again may delete it. A pack that
                        // creates a file owns it. A pack that writes over one
                        // that came with the build does not, and deleting that
                        // on removal would leave a hole in the core.
                        bool existed = File.Exists(full);
                        // In a game folder made of links, extracting over a
                        // linked file would rewrite Vortex's copy with it.
                        if (existed && inGame) OwnGame.Unshare(full);
                        e.ExtractToFile(full, true);
                        string under = full.Substring(fence.TrimEnd('\\', '/').Length).TrimStart('\\', '/');
                        wrote.Add((existed ? "R|" : "N|") + (inGame ? GameMark : "") + under);
                        if (inGame && !existed) newInGame.Add(under);
                        if (inGame) gameWritten.Add(under);
                        files++;
                    }
                }

                // A reference plugin list that arrived in this pack goes into
                // the file the game actually reads, now, rather than waiting
                // for somebody to press Fix.
                //
                // Until 22 September it waited. A release that moved the load
                // order installed cleanly, left the new list in
                // Profile\Default, and the game then turned the person away
                // with LOAD ORDER ERROR until they went back to the launcher
                // and pressed a button nothing had told them about. A first
                // time person reads that as the game being broken.
                //
                // Only this one step of Fix. The rest of Fix moves other
                // people's files aside and asks the server, and none of that
                // is wanted unprompted after every pack.
                if (carriedProfile)
                {
                    try
                    {
                        int settled = Verify.SettleLoadOrder();
                        if (settled > 0)
                            log("The plugin list this update carried is in place, so the load order is right without pressing Fix.");
                    }
                    catch (Exception ex)
                    {
                        log("Could not put this update's plugin list in place: " + ex.Message + ". Press Fix in the launcher.");
                    }
                }

                // Settings that shipped with the pack become the new baseline
                // and are pushed into the live profile too.
                Swap.RepairConfigs();
                try
                {
                    Directory.CreateDirectory(Paths.PacksDir);
                    File.WriteAllLines(PackListFile(p.id), wrote.ToArray());
                }
                catch (Exception ex) { Swallow.Note("Updater.Install, write", ex); }
                NoteInstalledIntoGame(newInGame);
                // The copies this pack just wrote are the ones to put back if
                // another server's launcher changes them. See Keep.
                int kept = Keep.Remember(gameWritten);
                if (kept > 0) log("Kept " + kept + " of " + Keep.Build() + "'s own game " + (kept == 1 ? "file" : "files") + " to put back if another server or build changes " + (kept == 1 ? "it." : "them."));
                // A file this pack took out must not come back at the next Play.
                Keep.Forget(removed);
                MarkApplied(p.id);
                log(p.id + " applied, " + files + " files.");
            }
        }

        /// <summary>
        /// Files a pack has just created inside the Steam copy join the list
        /// the uninstaller works from, so taking Thornswood out later takes
        /// them out too. The installer writes that list at install time and
        /// knows nothing about what arrived afterwards. Paths in it are
        /// relative to the game folder, one per line, which is what the
        /// uninstaller reads. Nothing is done on an install that has a game
        /// folder of its own, because that whole folder goes at uninstall, nor
        /// on one whose own folder was chosen and is not made yet, whose game
        /// files are in Profile\Payload and never in the Steam copy (#1226).
        /// The list is also what OwnGame.CleanSteamCopy takes out of the Steam
        /// copy once the folder is made.
        /// </summary>
        static void NoteInstalledIntoGame(List<string> rels)
        {
            if (!Paths.Collection || Paths.OwnFirst || rels == null || rels.Count == 0) return;
            try
            {
                string list = Path.Combine(Paths.ProfileDir, "installed-into-game.txt");
                var have = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (File.Exists(list))
                    foreach (string l in File.ReadAllLines(list))
                        if (l.Trim().Length > 0) have.Add(l.Trim());
                var add = new List<string>();
                foreach (string r in rels)
                    if (!have.Contains(r)) { have.Add(r); add.Add(r); }
                if (add.Count == 0) return;
                Directory.CreateDirectory(Paths.ProfileDir);
                File.AppendAllText(list, string.Join(Environment.NewLine, add.ToArray()) + Environment.NewLine);
            }
            catch (Exception ex) { Swallow.Note("Updater.NoteInstalledIntoGame, append", ex); }
        }

        /// <summary>
        /// Puts back into the queue every pack that a launcher before 1.1.32
        /// "applied" to a collection install. Returns how many.
        ///
        /// Such a pack left a file list with no header line and nothing but
        /// the two profile files in it, because the old fence skipped the
        /// whole game tree. The installer's own seeding of applied.txt leaves
        /// no file list at all, and those packs really are in the build, so
        /// they are left alone. A list written by this launcher starts with
        /// ListHeader and is trusted whatever it contains.
        ///
        /// Content based rather than a run-once flag on purpose: the update
        /// flow applies the packs with the launcher that is running and only
        /// then replaces the launcher, so the very update that carries this
        /// fix is applied once by the old code first. Its list has no header,
        /// so the new launcher sees it here on its first check and does it
        /// properly. Safe to call on every check; it only ever finds
        /// something once.
        /// </summary>
        public static int Requeue()
        {
            if (!Paths.Collection) return 0;
            int n = 0;
            try
            {
                if (!Directory.Exists(Paths.PacksDir)) return 0;
                foreach (string id in Applied())
                {
                    string list = PackListFile(id);
                    if (!File.Exists(list)) continue;
                    bool headed = false;
                    try
                    {
                        foreach (string l in File.ReadAllLines(list))
                        {
                            if (l.Trim().Length == 0) continue;
                            headed = l.Trim().Equals(ListHeader, StringComparison.Ordinal);
                            break;
                        }
                    }
                    catch { continue; }
                    if (headed) continue;
                    Unapply(id);
                    try { File.Delete(list); } catch (Exception ex) { Swallow.Note("Updater.Requeue, delete", ex); }
                    n++;
                }
            }
            catch (Exception ex) { Swallow.Note("Updater.Requeue, delete", ex); }
            return n;
        }

        /// <summary>
        /// Takes an optional pack back off.
        ///
        /// Only files the pack created are deleted. Anything it wrote over was
        /// part of the build before the pack arrived, and the zip did not keep
        /// a copy of what was there, so those are left alone and counted. The
        /// Scan and Fix buttons on the same page put those back, because that
        /// is exactly the job they already do: compare against the server list
        /// and re-download anything that does not match.
        /// </summary>
        public static void RemovePack(Config cfg, Pack p, Action<string> log)
        {
            if (p == null || string.IsNullOrEmpty(p.id)) return;

            string list = PackListFile(p.id);
            if (!File.Exists(list))
            {
                // Installed by a launcher old enough not to have kept a list.
                // Forgetting it is still better than claiming it is on when
                // there is no way to act on that.
                Unapply(p.id);
                log(p.Title + " has no file list, so nothing could be deleted. " +
                    "It is no longer listed as installed. Press Scan then Fix to " +
                    "put the build back the way the server expects it.");
                return;
            }

            int gone = 0, kept = 0, stuck = 0, shared = 0;
            // Read once, not per line.
            var claimed = ClaimedElsewhere(list);
            var deployed = DeployedNow(cfg);
            // Folder to prune from, and the fence it must never climb past.
            var dirs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            // Game relative paths this pack is taking out, for Keep below.
            var removed = new List<string>();
            foreach (string raw in File.ReadAllLines(list))
            {
                string line = raw.Trim();
                if (line.Length < 3 || line[1] != '|') continue;
                bool mine = line[0] == 'N';
                string rel = line.Substring(2);
                if (!mine) { kept++; continue; }
                // Something else has this file now: a pack that wrote over it
                // afterwards, or Vortex, which may have deployed a mod carrying
                // the same path since. Either way it is not this pack's to
                // delete, whatever its own list says.
                if (claimed.Contains(rel) ||
                    (rel.StartsWith(GameMark, StringComparison.OrdinalIgnoreCase) &&
                     deployed.Contains(rel.Substring(GameMark.Length))))
                {
                    shared++;
                    continue;
                }

                // A game line resolves under the game folder, wherever that
                // is. On an install with its own Game folder the old lists
                // read "Game\Data\...", relative to Root, which resolves to
                // the same file either way.
                string fence = Paths.Root;
                if (rel.StartsWith(GameMark, StringComparison.OrdinalIgnoreCase))
                {
                    fence = Paths.Game;
                    rel = rel.Substring(GameMark.Length);
                }

                string full;
                try { full = Path.GetFullPath(Path.Combine(fence, rel)); }
                catch { continue; }
                if (!PathFence.Inside(full, fence)) continue;

                try
                {
                    if (File.Exists(full))
                    {
                        File.Delete(full);
                        gone++;
                        string d = Path.GetDirectoryName(full);
                        if (!dirs.ContainsKey(d)) dirs[d] = fence;
                    }
                    // Taken from the resolved path rather than from the line,
                    // so an old list that wrote a game path relative to Root
                    // lands in the same place as a game\ one. Only a file that
                    // is really out of the way is recorded: one that would not
                    // delete is still in the game, so its kept copy stays.
                    if (PathFence.Inside(full, Paths.Game))
                        removed.Add(full.Substring(Paths.Game.TrimEnd('\\', '/').Length).TrimStart('\\', '/'));
                }
                catch { stuck++; }
            }

            // Folders the pack brought with it and nothing else is using.
            var order = new List<string>(dirs.Keys);
            order.Sort();
            order.Reverse();                      // deepest first
            foreach (string d in order)
            {
                string fence = dirs[d];
                try
                {
                    string at = d;
                    while (at.Length > fence.Length &&
                           PathFence.Inside(at, fence) &&
                           Directory.Exists(at) &&
                           Directory.GetFileSystemEntries(at).Length == 0)
                    {
                        Directory.Delete(at);
                        at = Path.GetDirectoryName(at);
                    }
                }
                catch (Exception ex) { Swallow.Note("Updater.RemovePack, rmdir", ex); }
            }

            // The kept copies go with the files. Install put a copy of every
            // Data\Platform file this pack wrote under Profile\Keep, and
            // Keep.Restore puts those back before every Play, so without this
            // the pack was in the game again at the next press of Play.
            Keep.Forget(removed);

            // Nothing is taken out of the Steam copy. A pack that went in while
            // this was a collection install can still have a copy there, and
            // this used to delete it, because a refresh brought back anything
            // the Steam copy had and the folder did not. A refresh takes only
            // Vortex's files now (#1218), so that copy never comes back, and
            // the Steam copy is the person's and is not written.

            try { File.Delete(list); } catch (Exception ex) { Swallow.Note("Updater.RemovePack, delete", ex); }
            Unapply(p.id);
            Swap.RepairConfigs();

            string msg = p.Title + " removed, " + gone + " file" + (gone == 1 ? "" : "s") + " deleted.";
            if (stuck > 0)
                msg += "  " + stuck + " would not delete, usually because Skyrim is still open.";
            if (kept > 0)
                msg += "  " + kept + " file" + (kept == 1 ? "" : "s") +
                       " here replaced part of the build and " + (kept == 1 ? "was" : "were") +
                       " left alone. Press Scan, then Fix, to put " +
                       (kept == 1 ? "it" : "those") + " back.";
            if (shared > 0)
                msg += "  " + shared + " file" + (shared == 1 ? "" : "s") +
                       " here " + (shared == 1 ? "is" : "are") +
                       " in use by another add-on or by the collection now and " +
                       (shared == 1 ? "was" : "were") + " left in place.";
            log(msg);
        }

        /// <summary>
        /// Who every program of an update has to be signed by: the launcher,
        /// the libraries beside it and Velopack's own programs in the package
        /// (VeloPackage.cs), Velopack's Update.exe, and the catalog of each
        /// release record (VeloRecord.cs, FeedManifest.cs).
        ///
        /// Match on a distinctive part of the certificate's Subject line rather
        /// than the whole of it, because certificate authorities add and
        /// reorder fields between renewals and an exact-match check would
        /// refuse a perfectly good update the day the certificate is renewed.
        ///
        /// Since #912 this is the last of five checks, not the only one:
        /// Signature.cs first has Windows verify the signature and pins
        /// Microsoft's Artifact Signing and Thornswood's durable identity.
        /// scripts\release\Assert-PublishSigned.ps1 reads this line.
        ///
        /// This is one layer, not the only one. The sha256 a release names
        /// decides the bytes are the ones published, the signed release record
        /// decides somebody holding the signing right published them, and this
        /// decides who built each program. Removing any of them because the
        /// others exist would be a straight loss.
        ///
        /// The launcher's own self update (the download named by version.json's
        /// launcherUrl, and the swap script in SelfSwap.cs that kept
        /// Thornswood.exe.old) went with #4825: the launcher updates through
        /// Velopack now, with every check in VeloUpdate.cs.
        /// </summary>
        public const string ExpectedSigner = "Gavin Knotts";
    }
}
