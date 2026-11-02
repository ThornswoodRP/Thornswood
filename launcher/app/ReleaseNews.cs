using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// THE NEWS TAB READS THE RELEASES (#5187, plan line 32). Every merge that
    /// changes what Thornswood ships makes one build Release on GitHub,
    /// "Release build-&lt;yyyyMMdd&gt;.&lt;n&gt;", whose body is the note people
    /// read: the Release note lines of the pull requests merged since the
    /// Release before (merge-release.yml, THE NOTES). The box deploy agent
    /// puts a Release on dev by its Deployment to Dev and on the live server
    /// by its Deployment to Main, and sets the Deployment to success once the
    /// server runs it. Which release a channel has is that Deployment
    /// (DECIDED.md, q-p13-channel-from-deployment), and the bot posts the news
    /// at that same moment (q-p15-news-on-deploy).
    ///
    /// Until this the tab read the feed's news file (FeedNews.cs, #1050),
    /// which only a Ship wrote, so a release that went out through a
    /// Deployment never reached the tab: build-20261101.9 was on dev at
    /// 4:10 PM on 1 Nov and dev's news file still ended at the 2:22 PM Ship.
    /// Now the tab is the notes of the build Releases at or before the one
    /// this channel's newest successful Deployment names, newest first. On a
    /// dev launcher each note main's Deployment has not reached yet is marked
    /// DEV, which is the list of what wants testing before dev goes over.
    ///
    /// What is asked, all of it from GitHub's API without a token (the
    /// repository is public): the channel's Deployments, the newest status of
    /// those that name a build Release until one is success, the same for
    /// Main on a dev launcher, and the newest hundred Releases. Asked without
    /// a token GitHub allows sixty requests an hour from one address, and the
    /// launcher's update check runs every thirty seconds while the game runs,
    /// so the answer is kept and asked again at most every NewsEvery. A read
    /// that fails keeps the notes from the last one that worked, says why in
    /// launcher.log, and never fails the update check: the news is cosmetic.
    /// </summary>
    static partial class Updater
    {
        const string ReleasesApi = "https://api.github.com/repos/" + Velo.Repo;

        /// <summary>How long a read of the Releases stands before it is asked again.</summary>
        static readonly TimeSpan NewsEvery = TimeSpan.FromMinutes(15);

        /// <summary>
        /// How many Deployments' statuses one read asks at most before it
        /// gives up on finding a successful one. Each is one request.
        /// </summary>
        const int NewsStatusReads = 6;

        /// <summary>
        /// The body merge-release.yml writes when every change in the Release
        /// says none (its NOTHING_TO_TELL), the same test the bot makes.
        /// </summary>
        static readonly Regex NothingToTell = new Regex(@"^\s*nothing people would notice\b", RegexOptions.IgnoreCase);

        static readonly Regex BuildTag = new Regex(@"^build-(\d{8})\.(\d{1,9})$");

        static readonly object newsLock = new object();
        static NewsItem[] newsHeld;
        static string newsChannel;
        static DateTime newsAsked = DateTime.MinValue;

        /// <summary>
        /// The Releases' notes for this launcher's channel into v.news, read
        /// from GitHub when the last read is older than NewsEvery. Runs on
        /// the update check's own thread. Never throws.
        /// </summary>
        public static void FillNews(Config cfg, VersionDoc v)
        {
            if (v == null) return;
            bool dev = cfg != null && cfg.IsDev;
            string channel = dev ? "dev" : "main";
            bool ask;
            lock (newsLock)
            {
                if (newsChannel != channel) { newsHeld = null; newsAsked = DateTime.MinValue; newsChannel = channel; }
                ask = DateTime.UtcNow - newsAsked >= NewsEvery;
                // Set before the read, so a read that fails is not asked again
                // on every check until NewsEvery has gone by.
                if (ask) newsAsked = DateTime.UtcNow;
            }
            if (ask)
            {
                try
                {
                    NewsItem[] read = ReadReleaseNews(ReleasesApi, dev);
                    lock (newsLock) { if (newsChannel == channel) newsHeld = read; }
                }
                catch (Exception ex) { Swallow.Note("Updater.FillNews, the Releases on GitHub", ex); }
            }
            lock (newsLock) { v.news = newsHeld ?? new NewsItem[0]; }
        }

        /// <summary>
        /// The notes as GitHub has them now, from api (the repository's API
        /// address, a server of its own in tests\test-5187-launcher-news.ps1).
        /// Throws when GitHub could not be read, which is not the same as no
        /// news.
        /// </summary>
        internal static NewsItem[] ReadReleaseNews(string api, bool dev)
        {
            string on = DeployedRelease(api, dev ? "Dev" : "Main");
            if (on == null) return new NewsItem[0];
            string main = dev ? DeployedRelease(api, "Main") : on;
            List<GitHubRelease> releases = JsonSerializer.Deserialize(GitHubGet(api + "/releases?per_page=100"), ReleaseNewsJson.Default.ListGitHubRelease);
            return NewsOf(releases, on, main);
        }

        /// <summary>
        /// The tag of the build Release the newest successful Deployment to
        /// environment names, or null when none of its Deployments names one
        /// that succeeded. A Deployment that names no build Release (a Ship's
        /// record from before #5179, or the one GitHub lists for a job waiting
        /// on an approval) is passed over without asking its status. GitHub
        /// lists Deployments newest first, and a newer one still running or
        /// failed leaves the server on the one before, so the first success
        /// is the answer.
        /// </summary>
        static string DeployedRelease(string api, string environment)
        {
            List<GitHubDeployment> list = JsonSerializer.Deserialize(
                GitHubGet(api + "/deployments?environment=" + Uri.EscapeDataString(environment) + "&per_page=20"),
                ReleaseNewsJson.Default.ListGitHubDeployment);
            if (list == null) return null;
            int asked = 0;
            foreach (GitHubDeployment d in list)
            {
                string tag = d == null ? null : d.ReleaseTag;
                if (BuildKey(tag) < 0) continue;
                if (asked == NewsStatusReads)
                    throw new Exception("none of the newest " + NewsStatusReads + " Deployments to " + environment + " that name a release ended in success");
                asked++;
                List<GitHubStatus> st = JsonSerializer.Deserialize(
                    GitHubGet(api + "/deployments/" + d.Id.ToString(CultureInfo.InvariantCulture) + "/statuses?per_page=1"),
                    ReleaseNewsJson.Default.ListGitHubStatus);
                if (st != null && st.Count > 0 && st[0] != null && st[0].State == "success") return tag;
            }
            return null;
        }

        /// <summary>
        /// The notes of the build Releases at or before on, newest first, each
        /// marked dev when it is after main (main null: main has none yet).
        /// A Release counts when it is published, its tag is a build tag and
        /// its title is the one merge-release.yml gives a Release with notes,
        /// "Release " and the tag; the gamemode-only builds from before
        /// #5313 carried no notes and are left out by that title. A body
        /// that says nothing people would notice is no note.
        /// </summary>
        internal static NewsItem[] NewsOf(List<GitHubRelease> releases, string on, string main)
        {
            long top = BuildKey(on);
            long mainTop = BuildKey(main);
            var picked = new List<KeyValuePair<long, NewsItem>>();
            if (releases == null || top < 0) return new NewsItem[0];
            var seen = new HashSet<long>();
            foreach (GitHubRelease r in releases)
            {
                if (r == null || r.Draft) continue;
                long k = BuildKey(r.TagName);
                if (k < 0 || k > top || !seen.Add(k)) continue;
                if (!string.Equals(r.Name, "Release " + r.TagName, StringComparison.Ordinal)) continue;
                NewsItem n = NoteOf(r.Body, r.PublishedAt);
                if (n == null) continue;
                if (mainTop < 0 || k > mainTop) n.channel = "dev";
                picked.Add(new KeyValuePair<long, NewsItem>(k, n));
            }
            picked.Sort((a, b) => b.Key.CompareTo(a.Key));
            var items = new NewsItem[picked.Count];
            for (int i = 0; i < items.Length; i++) items[i] = picked[i].Value;
            return items;
        }

        /// <summary>
        /// One Release's body as a note, in the shape Collect-ReleaseNotes.ps1
        /// joins it: the first line is the title, each "- " line after it is
        /// one line of what changed (later pull requests' headlines among
        /// them), and any other line is the note's text. Null for a body with
        /// nothing in it or nothing people would notice. The date is when
        /// the Release was published, in this machine's time.
        /// </summary>
        internal static NewsItem NoteOf(string body, DateTimeOffset? published)
        {
            string text = body ?? "";
            if (text.Trim().Length == 0 || NothingToTell.IsMatch(text)) return null;
            var n = new NewsItem();
            var details = new List<string>();
            var lines = new List<string>();
            foreach (string raw in text.Replace("\r", "").Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0) continue;
                bool bullet = line.StartsWith("- ", StringComparison.Ordinal);
                string said = bullet ? line.Substring(2).Trim() : line;
                if (said.Length == 0) continue;
                if (n.title.Length == 0) n.title = said;
                else if (bullet) details.Add(said);
                else lines.Add(said);
            }
            n.body = string.Join("\n", lines);
            n.details = details.Count > 0 ? details.ToArray() : null;
            n.date = published.HasValue ? published.Value.ToLocalTime().ToString("M-d-yyyy h:mm tt", CultureInfo.InvariantCulture) : "";
            return n;
        }

        /// <summary>
        /// A build tag as a number that sorts the way the Releases were made:
        /// the day, then the day's count. -1 for anything else.
        /// </summary>
        internal static long BuildKey(string tag)
        {
            if (string.IsNullOrEmpty(tag)) return -1;
            Match m = BuildTag.Match(tag);
            if (!m.Success) return -1;
            return long.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) * 1000000000L
                 + long.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
        }

        /// <summary>
        /// One read of GitHub's API: the body of a 2xx answer, and an
        /// exception for any other. No token goes with it: what it reads is
        /// public, and a token in config.json is for the update feed alone.
        /// </summary>
        static byte[] GitHubGet(string url)
        {
            using (var req = new HttpRequestMessage(HttpMethod.Get, url))
            {
                req.Headers.TryAddWithoutValidation("User-Agent", "ThornswoodLauncher/" + Version);
                req.Headers.TryAddWithoutValidation("Accept", "application/vnd.github+json");
                req.Headers.TryAddWithoutValidation("X-GitHub-Api-Version", "2022-11-28");
                using (HttpResponseMessage res = Http.Send(req, AnswerMs))
                {
                    if (!res.IsSuccessStatusCode) throw Refused(res);
                    return Http.Body(res, Http.DefaultReadMs);
                }
            }
        }

        /// <summary>What the tab reads of a Release in GitHub's list.</summary>
        internal sealed class GitHubRelease
        {
            [JsonPropertyName("tag_name")] public string TagName { get; set; }
            [JsonPropertyName("name")] public string Name { get; set; }
            [JsonPropertyName("body")] public string Body { get; set; }
            [JsonPropertyName("draft")] public bool Draft { get; set; }
            [JsonPropertyName("published_at")] public DateTimeOffset? PublishedAt { get; set; }
        }

        /// <summary>
        /// What the tab reads of a Deployment: its id, and the build Release
        /// its payload names ({"release": "build-..."}, merge-release.yml and
        /// promote-main.yml). The payload is read as it comes, since GitHub
        /// gives an object, an empty one or a string.
        /// </summary>
        internal sealed class GitHubDeployment
        {
            [JsonPropertyName("id")] public long Id { get; set; }
            [JsonPropertyName("payload")] public JsonElement Payload { get; set; }

            [JsonIgnore]
            public string ReleaseTag
            {
                get
                {
                    JsonElement r;
                    if (Payload.ValueKind != JsonValueKind.Object || !Payload.TryGetProperty("release", out r) || r.ValueKind != JsonValueKind.String)
                        return null;
                    return r.GetString();
                }
            }
        }

        /// <summary>A Deployment's status: success once the agent has the server on it.</summary>
        internal sealed class GitHubStatus
        {
            [JsonPropertyName("state")] public string State { get; set; }
        }
    }

    /// <summary>
    /// GitHub's answers the News tab reads, compiled when the launcher builds
    /// (no reflection, so it works in the native build). Strings read
    /// loosely (LooseString), like every document from outside.
    /// </summary>
    [JsonSourceGenerationOptions(Converters = new[] { typeof(LooseString) })]
    [JsonSerializable(typeof(List<Updater.GitHubRelease>))]
    [JsonSerializable(typeof(List<Updater.GitHubDeployment>))]
    [JsonSerializable(typeof(List<Updater.GitHubStatus>))]
    internal partial class ReleaseNewsJson : JsonSerializerContext
    {
    }
}
