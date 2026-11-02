using System;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Thornswood
{
    /// <summary>
    /// The three pages a person accepts before Install, and the record of it.
    ///
    /// Issue #1009, Patrick on 28 September: "check boxes that lock the
    /// install for reading and accepting terms and conditions, privacy
    /// policy, and agreeing to the rules", "and links to all 3". Each name is
    /// the page's address on the site, its name for /api/page, and the box
    /// and link in InstallWindow. The launcher reads the same record
    /// (Acceptance.cs) and asks again when it is missing or a page changed.
    /// </summary>
    static class InstallAgreements
    {
        public const string Site = "https://thornswood.net";
        public static readonly string[] Pages = { "terms", "privacy", "rules" };
        public const string AcceptedFile = "accepted.json";

        /// <summary>The words of each page's box, in the order of Pages.</summary>
        public static readonly string[] Words =
        {
            "I have read and accept the Terms and Conditions",
            "I have read and accept the Privacy Policy",
            "I have read and agree to the Rules",
        };

        /// <summary>The age box, which sits above the three.</summary>
        public const string AgeWords = "I am 18 or over. Thornswood is an adult server.";

        /// <summary>
        /// Install is on only while every box is ticked. A box somebody can
        /// ignore and press Install anyway is decoration, so they gate the
        /// button rather than sitting next to it.
        /// </summary>
        public static bool AllTicked(bool?[] boxes)
        {
            if (boxes == null || boxes.Length == 0) return false;
            foreach (bool? b in boxes) if (b != true) return false;
            return true;
        }

        /// <summary>
        /// Whether an address may be opened in the browser from the window:
        /// the site's own pages and nothing else. This is the one process the
        /// window starts, and it only ever hands Windows an https address on
        /// thornswood.net.
        /// </summary>
        public static bool IsSitePage(string url)
        {
            return url != null && url.StartsWith(Site + "/", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>SHA-256 of a page's text as UTF-8, lower case hex: the version that was accepted.</summary>
        public static string PageSha(string md)
        {
            if (md == null) return "";
            return Convert.ToHexStringLower(SHA256.HashData(new UTF8Encoding(false).GetBytes(md)));
        }

        /// <summary>
        /// What goes in Profile\accepted.json. shas are in the order of Pages,
        /// empty for a page the site did not answer for. No name, no account,
        /// nothing about the machine: when, which pages, which versions.
        /// </summary>
        public static string Json(DateTime at, string[] shas)
        {
            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"accepted\": \"" + at.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture) + "\",\n");
            sb.Append("  \"pages\": {\n");
            for (int i = 0; i < Pages.Length; i++)
            {
                string sha = shas != null && i < shas.Length && shas[i] != null ? shas[i] : "";
                sb.Append("    \"" + Pages[i] + "\": { \"url\": \"" + Site + "/" + Pages[i] +
                          "\", \"sha256\": \"" + sha + "\" }" + (i < Pages.Length - 1 ? "," : "") + "\n");
            }
            sb.Append("  },\n");
            sb.Append("  \"about\": \"Ticked in Thornswood Setup before Install. sha256 is of each page's text as " +
                      Site + "/api/page/<name> served it when Install was pressed, and is empty when the site " +
                      "did not answer.\"\n");
            sb.Append("}\n");
            return sb.ToString();
        }

        /// <summary>
        /// The page's text as the site serves it now, {"md":"...","html":"..."},
        /// or null when the site did not answer with one.
        /// </summary>
        static string FetchPage(HttpClient http, string name)
        {
            string doc = http.GetStringAsync(Site + "/api/page/" + name).GetAwaiter().GetResult();
            using (JsonDocument d = JsonDocument.Parse(doc))
            {
                JsonElement md;
                if (d.RootElement.ValueKind == JsonValueKind.Object && d.RootElement.TryGetProperty("md", out md) && md.ValueKind == JsonValueKind.String)
                    return md.GetString();
                return null;
            }
        }

        /// <summary>
        /// Writes Profile\accepted.json in the install. The site not answering
        /// is not a stop: the boxes were ticked whatever it says, and a page
        /// it did not answer for is recorded with an empty hash. A record that
        /// cannot be written is said, and the install's own check of the
        /// record then stops it before anything is installed.
        /// </summary>
        public static void Record(string profileDir, DateTime at, Action<string> say)
        {
            var shas = new string[Pages.Length];
            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) })
            {
                http.DefaultRequestHeaders.UserAgent.ParseAdd("ThornswoodSetup");
                for (int i = 0; i < Pages.Length; i++)
                {
                    try { shas[i] = PageSha(FetchPage(http, Pages[i])); }
                    catch (Exception e) when (e is HttpRequestException || e is System.Threading.Tasks.TaskCanceledException || e is JsonException)
                    {
                        say("  The site did not answer for the " + Pages[i] + " page (" + e.Message + "), so its version is recorded empty.");
                        shas[i] = "";
                    }
                }
            }
            try
            {
                Directory.CreateDirectory(profileDir);
                File.WriteAllText(Path.Combine(profileDir, AcceptedFile), Json(at, shas), new UTF8Encoding(false));
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
            {
                say("Could not note what you accepted: " + e.Message);
            }
        }
    }
}
