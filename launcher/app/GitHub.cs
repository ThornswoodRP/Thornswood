using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// THE LAUNCHER READS ITS UPDATES FROM GITHUB ITSELF (#5608, Patrick on
    /// 11 Nov 2026: "the updates should not be held on thornswood.net or the
    /// VPS but on GitHub, this should block play but not updates"). The list
    /// of Releases, every Velopack feed and package, and the signed release
    /// record with its lists come from this repository's Releases through
    /// GitHub's API, so an update goes in while thornswood.net or the box is
    /// down. Only Play waits on the site, which hands out the join pass.
    ///
    /// Through api.github.com, never github.com's download addresses: on
    /// 9 Nov 2026 GitHub answered every anonymous request to github.com with
    /// 504 for hours while its API kept answering. A file is asked for at its
    /// API address with Accept: application/octet-stream, and GitHub answers
    /// 302 to its storage (release-assets.githubusercontent.com), which the
    /// client follows.
    ///
    /// THE HOUR'S SIXTY. The launcher holds no token, and GitHub allows sixty
    /// API calls an hour from one address without one. GitHub's docs say a
    /// conditional request answered 304 is spared from that only when it is
    /// signed in, so every call counts, and the calls are kept few instead:
    /// one read of the list serves every reader for ListFresh (the update
    /// check, main's number on the News tab, the News tab's notes); a file of
    /// a Release is downloaded once and kept on disk under Profile\GitHub,
    /// since Releases here are immutable once published; and Velopack is
    /// held to MaxDeltas deltas (VeloUpdate.cs). When GitHub says the hour's
    /// calls are spent, nothing more is asked until the time it gives for
    /// the reset, and every caller is told that time.
    /// </summary>
    static class GitHub
    {
        /// <summary>This repository's API address. A harness points it at a server of its own.</summary>
        internal static string Api = "https://api.github.com/repos/" + Velo.Repo;

        /// <summary>How long one read of the Release list serves every reader.</summary>
        static readonly TimeSpan ListFresh = TimeSpan.FromMinutes(1);

        /// <summary>How many Releases one page of the list holds, and how many pages a reader may walk.</summary>
        const int PerPage = 100;
        const int MaxPages = 5;

        const int AnswerMs = 10000;

        /// <summary>A Release as GitHub's API gives it, the parts the launcher reads.</summary>
        internal sealed class Release
        {
            [JsonPropertyName("tag_name")] public string TagName { get; set; }
            [JsonPropertyName("name")] public string Name { get; set; }
            [JsonPropertyName("body")] public string Body { get; set; }
            [JsonPropertyName("draft")] public bool Draft { get; set; }
            [JsonPropertyName("prerelease")] public bool Prerelease { get; set; }
            [JsonPropertyName("published_at")] public DateTimeOffset? PublishedAt { get; set; }
            [JsonPropertyName("assets")] public Asset[] Assets { get; set; }

            /// <summary>The file called <paramref name="name"/> GitHub has finished taking, or null.</summary>
            public Asset File(string name)
            {
                if (Assets == null) return null;
                foreach (Asset a in Assets)
                    if (a != null && a.Uploaded && string.Equals(a.Name, name, StringComparison.OrdinalIgnoreCase)) return a;
                return null;
            }
        }

        internal sealed class Asset
        {
            [JsonPropertyName("id")] public long Id { get; set; }
            [JsonPropertyName("url")] public string Url { get; set; }
            [JsonPropertyName("name")] public string Name { get; set; }
            [JsonPropertyName("size")] public long Size { get; set; }
            [JsonPropertyName("state")] public string State { get; set; }
            /// <summary>"sha256:" and GitHub's own sha256 of the file.</summary>
            [JsonPropertyName("digest")] public string Digest { get; set; }

            [JsonIgnore] public bool Uploaded { get { return State == null || State == "uploaded"; } }

            /// <summary>GitHub's sha256 of the file, lower case, or "" when it gave none.</summary>
            [JsonIgnore]
            public string Sha256
            {
                get
                {
                    string d = Digest ?? "";
                    return d.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase) ? d.Substring(7).ToLowerInvariant() : "";
                }
            }
        }

        // ---------------------------------------------------------------- the hour's calls

        static readonly object limitGate = new object();
        static DateTime spentUntil = DateTime.MinValue;

        /// <summary>Calls GitHub said were left this hour at the last answer, or -1 before one.</summary>
        public static int Left { get; private set; } = -1;

        /// <summary>
        /// Empty while GitHub may be asked; otherwise why not, as a sentence:
        /// the hour's calls from this address are spent until the reset.
        /// </summary>
        public static string Refusal()
        {
            lock (limitGate)
            {
                if (DateTime.UtcNow >= spentUntil) return "";
                return "GitHub's sixty calls an hour for this internet address are used up until " +
                       spentUntil.ToLocalTime().ToString("h:mm tt", CultureInfo.InvariantCulture) +
                       ", so the launcher asks again after that. Other launchers on the same network share the sixty.";
            }
        }

        // What GitHub said about the hour, from any answer of its API.
        static void Heard(HttpResponseMessage res)
        {
            int left;
            string l = HeaderOf(res, "X-RateLimit-Remaining");
            if (l == null || !int.TryParse(l, NumberStyles.Integer, CultureInfo.InvariantCulture, out left)) return;
            Left = left;
            bool refused = res.StatusCode == HttpStatusCode.Forbidden || (int)res.StatusCode == 429;
            if (left > 0 || !refused) return;
            long reset;
            string r = HeaderOf(res, "X-RateLimit-Reset");
            DateTime until = r != null && long.TryParse(r, NumberStyles.Integer, CultureInfo.InvariantCulture, out reset)
                ? DateTimeOffset.FromUnixTimeSeconds(reset).UtcDateTime
                : DateTime.UtcNow.AddHours(1);
            lock (limitGate) spentUntil = until;
        }

        static string HeaderOf(HttpResponseMessage res, string name)
        {
            IEnumerable<string> v;
            if (res.Headers.TryGetValues(name, out v) || res.Content.Headers.TryGetValues(name, out v))
                return string.Join(", ", v);
            return null;
        }

        /// <summary>
        /// One call to the API: the body of a 2xx answer, or an exception that
        /// says what GitHub answered. Asks nothing while the hour's calls are
        /// spent. 404 is an exception of its own, NotThere.
        /// </summary>
        static byte[] Get(string url, string accept)
        {
            string no = Refusal();
            if (no.Length > 0) throw new Exception(no);
            using (var req = new HttpRequestMessage(HttpMethod.Get, url))
            {
                req.Headers.TryAddWithoutValidation("User-Agent", "ThornswoodLauncher/" + Updater.Version);
                req.Headers.TryAddWithoutValidation("Accept", accept);
                req.Headers.TryAddWithoutValidation("X-GitHub-Api-Version", "2022-11-28");
                using (HttpResponseMessage res = Http.Send(req, AnswerMs))
                {
                    Heard(res);
                    if (res.StatusCode == HttpStatusCode.NotFound) throw new NotThere(url);
                    if (!res.IsSuccessStatusCode)
                    {
                        no = Refusal();
                        throw new Exception(no.Length > 0 ? no : "GitHub answered " + (int)res.StatusCode + " " + res.ReasonPhrase + " for " + url + ".");
                    }
                    return Http.Body(res, Http.DefaultReadMs);
                }
            }
        }

        /// <summary>
        /// One call to the API at <paramref name="path"/> under this
        /// repository's address (the News tab's Deployments and their
        /// statuses), counted with every other. Throws as Get does.
        /// </summary>
        internal static byte[] Json(string path)
        {
            if (string.IsNullOrEmpty(path) || !path.StartsWith("/", StringComparison.Ordinal)) throw new ArgumentException("path");
            return Get(Api + path, "application/vnd.github+json");
        }

        /// <summary>
        /// Forgets the Release list, the Releases read by tag and the hour's
        /// reset, so a harness can point Api somewhere else and start over.
        /// Files kept on disk stay.
        /// </summary>
        internal static void Forget()
        {
            lock (listGate) { pages.Clear(); listAt = DateTime.MinValue; byTag.Clear(); }
            lock (limitGate) spentUntil = DateTime.MinValue;
            Left = -1;
        }

        internal sealed class NotThere : Exception
        {
            public NotThere(string url) : base("GitHub has nothing at " + url + ".") { }
        }

        // ---------------------------------------------------------------- the Release list

        static readonly object listGate = new object();
        static readonly List<Release[]> pages = new List<Release[]>();
        static DateTime listAt = DateTime.MinValue;

        /// <summary>
        /// The published Releases, newest first by when they were published,
        /// enough of them that <paramref name="need"/> pass
        /// <paramref name="wanted"/> (fewer when the list ends first): the
        /// first page of a hundred, and the next only when the first holds too
        /// few. GitHub's own order is not by publishing (a Release promoted to
        /// main later sits by its commit), so the pages read are sorted here.
        /// One read serves every reader for ListFresh. Throws when GitHub
        /// could not be read.
        /// </summary>
        internal static List<Release> Releases(Func<Release, bool> wanted, int need)
        {
            lock (listGate)
            {
                if (DateTime.UtcNow - listAt >= ListFresh) { pages.Clear(); listAt = DateTime.MinValue; }
                while (true)
                {
                    List<Release> all = Published();
                    bool ended = pages.Count > 0 && pages[pages.Count - 1].Length < PerPage;
                    if (pages.Count > 0 && (ended || pages.Count >= MaxPages || all.Count(wanted) >= need)) return all;
                    byte[] raw = Get(Api + "/releases?per_page=" + PerPage + "&page=" + (pages.Count + 1), "application/vnd.github+json");
                    Release[] page = JsonSerializer.Deserialize(raw, GitHubJson.Default.ReleaseArray) ?? new Release[0];
                    if (pages.Count == 0) listAt = DateTime.UtcNow;
                    pages.Add(page);
                }
            }
        }

        static List<Release> Published()
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var all = new List<Release>();
            foreach (Release[] p in pages)
                foreach (Release r in p)
                    if (r != null && !r.Draft && r.PublishedAt != null && !string.IsNullOrEmpty(r.TagName) && seen.Add(r.TagName)) all.Add(r);
            return all.OrderByDescending(r => r.PublishedAt.Value).ToList();
        }

        // Releases read by their tag this run. A published Release here is
        // immutable, so one read is enough.
        static readonly Dictionary<string, Release> byTag = new Dictionary<string, Release>(StringComparer.Ordinal);

        static readonly Regex SafeName = new Regex(@"^[A-Za-z0-9._-]{1,200}$");

        /// <summary>
        /// The published Release <paramref name="tag"/>: from the list when it
        /// is on the pages already read, otherwise asked for by its tag. Throws
        /// when GitHub has no such Release or could not be read.
        /// </summary>
        internal static Release Tag(string tag)
        {
            if (string.IsNullOrEmpty(tag) || !SafeName.IsMatch(tag)) throw new Exception("\"" + tag + "\" is not a Release tag.");
            lock (listGate)
            {
                foreach (Release r in Published()) if (r.TagName == tag) return r;
                Release had;
                if (byTag.TryGetValue(tag, out had)) return had;
            }
            Release got;
            try { got = JsonSerializer.Deserialize(Get(Api + "/releases/tags/" + Uri.EscapeDataString(tag), "application/vnd.github+json"), GitHubJson.Default.Release); }
            catch (NotThere) { throw new Exception("GitHub has no Release " + tag + "."); }
            if (got == null || got.Draft || got.TagName != tag) throw new Exception("GitHub has no published Release " + tag + ".");
            lock (listGate) byTag[tag] = got;
            return got;
        }

        // ---------------------------------------------------------------- files of a Release

        /// <summary>Where the files of Releases are kept once downloaded: Profile\GitHub, or null before Paths knows Profile.</summary>
        static string KeptDir
        {
            get
            {
                string p = Paths.ProfileDir;
                return string.IsNullOrEmpty(p) ? null : Path.Combine(p, "GitHub");
            }
        }

        /// <summary>
        /// The bytes of the file <paramref name="name"/> of the published
        /// Release <paramref name="tag"/>: the copy kept from an earlier
        /// download when there is one, since a published Release here never
        /// changes, and otherwise downloaded through the API, held to the
        /// sha256 GitHub gives for it, and kept. For the small files: the
        /// Velopack feeds and the signed record and its lists. Callers still
        /// hold what they read to its signature or its signed sha256 every
        /// time. Throws when the Release or the file is not there or GitHub
        /// could not be read.
        /// </summary>
        internal static byte[] File(string tag, string name)
        {
            if (string.IsNullOrEmpty(name) || !SafeName.IsMatch(name)) throw new Exception("\"" + name + "\" is not a file name a Release carries.");
            string dir = KeptDir;
            string kept = dir == null ? null : Path.Combine(dir, tag, name);
            if (kept != null && System.IO.File.Exists(kept))
            {
                try { return System.IO.File.ReadAllBytes(kept); }
                catch (Exception ex) { Swallow.Note("GitHub.File, read the kept " + tag + "/" + name, ex); }
            }
            Release r = Tag(tag);
            Asset a = r.File(name);
            if (a == null) throw new Exception("The Release " + tag + " on GitHub has no " + name + ".");
            byte[] b = Download(a);
            if (kept != null)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(kept));
                    string part = kept + ".part";
                    System.IO.File.WriteAllBytes(part, b);
                    System.IO.File.Move(part, kept, true);
                }
                catch (Exception ex) { Swallow.Note("GitHub.File, keep " + tag + "/" + name, ex); }
            }
            return b;
        }

        /// <summary>
        /// One file of a Release through the API (one of the hour's calls),
        /// held to GitHub's sha256 of it. Throws with the reason.
        /// </summary>
        internal static byte[] Download(Asset a)
        {
            string url = AssetUrl(a);
            byte[] b = Get(url, "application/octet-stream");
            string want = a.Sha256;
            if (want.Length > 0)
            {
                string got = Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
                if (got != want) throw new Exception(a.Name + " arrived from GitHub as " + got + ", and GitHub lists it as " + want + ".");
            }
            return b;
        }

        /// <summary>
        /// The API address of an asset, which has to be one of this
        /// repository's Release files: nothing in a list GitHub sent can send
        /// the launcher anywhere else. Throws for anything else.
        /// </summary>
        internal static string AssetUrl(Asset a)
        {
            string want = Api + "/releases/assets/";
            string url = a == null ? null : a.Url;
            if (string.IsNullOrEmpty(url) || !url.StartsWith(want, StringComparison.OrdinalIgnoreCase) ||
                !Regex.IsMatch(url.Substring(want.Length), @"^\d{1,19}$"))
                throw new Exception("GitHub's list named " + (url ?? "nothing") + " for " + (a == null ? "a file" : a.Name) + ", which is not one of this repository's Release files.");
            return url;
        }
    }

    /// <summary>GitHub's answers, compiled when the launcher builds (no reflection, so it works in the native build).</summary>
    [JsonSerializable(typeof(GitHub.Release))]
    [JsonSerializable(typeof(GitHub.Release[]))]
    internal partial class GitHubJson : JsonSerializerContext
    {
    }
}
