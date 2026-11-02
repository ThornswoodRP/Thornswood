using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Velopack;
using Velopack.Sources;

namespace Thornswood
{
    /// <summary>
    /// THE SIGNED RELEASE RECORD OF A VELOPACK PACKAGE (#4825, #2163).
    ///
    /// Velopack checks that a package is the bytes its channel's feed names,
    /// but the feed and the package come from the same place, so that alone
    /// never says who released it. Every merge release also carries
    /// manifest.json, the name and sha256 of each of its files, and
    /// manifest.cat, a Windows catalog over manifest.json signed with
    /// ThornswoodRelease on GitHub's runner, from main's own workflow only
    /// (scripts/release/New-SignedManifest.ps1, Sign-OnRunner.ps1). A file
    /// that manifest lists was released by someone holding the signing right.
    ///
    /// The Release a package belongs to is named by its version: one time and
    /// one run number give both (scripts/release/MergeRelease.ps1,
    /// New-MergeReleaseNames), version yyyy.(month*100+day).run and tag
    /// build-yyyyMMdd.run. So the record is fetched from that tag whichever
    /// Release served the package. Main's package of the same version (the
    /// part "main", packed beside dev's and listed in the same record) is
    /// published from a Release of its own once Patrick approves it (#5181),
    /// and is held to the record the merge release signed.
    ///
    /// Fetched from github.com's download addresses, never the API, so the
    /// check spends none of the sixty anonymous API requests an hour.
    /// </summary>
    static class VeloRecord
    {
        public sealed class PartFile
        {
            [JsonPropertyName("name")] public string Name { get; set; }
            [JsonPropertyName("sha256")] public string Sha256 { get; set; }
            [JsonPropertyName("size")] public long Size { get; set; }
        }

        /// <summary>manifest.json as New-SignedManifest.ps1 writes it.</summary>
        public sealed class Manifest
        {
            [JsonPropertyName("schema")] public int Schema { get; set; }
            [JsonPropertyName("repo")] public string Repo { get; set; }
            [JsonPropertyName("commit")] public string Commit { get; set; }
            [JsonPropertyName("tag")] public string Tag { get; set; }
            [JsonPropertyName("version")] public string Version { get; set; }
            [JsonPropertyName("launcherVersion")] public string LauncherVersion { get; set; }
            [JsonPropertyName("parts")] public Dictionary<string, PartFile[]> Parts { get; set; }

            /// <summary>The file of <paramref name="part"/> called <paramref name="name"/>, or null.</summary>
            public PartFile File(string part, string name)
            {
                PartFile[] files;
                if (Parts == null || !Parts.TryGetValue(part, out files) || files == null) return null;
                foreach (PartFile f in files)
                    if (f != null && string.Equals(f.Name, name, StringComparison.Ordinal)) return f;
                return null;
            }
        }

        public sealed class GameFile
        {
            [JsonPropertyName("path")] public string Path { get; set; }
            [JsonPropertyName("size")] public long Size { get; set; }
            [JsonPropertyName("sha256")] public string Sha256 { get; set; }
        }

        /// <summary>
        /// A game file the release no longer ships, as a release record's
        /// :gone: entry says it (Sync.cs): "always", the sha256 of the bytes
        /// once shipped, or anything else for a file of ours to leave when
        /// Vortex deploys that path (Build-GameFiles.ps1 writes them).
        /// </summary>
        public sealed class GoneFile
        {
            [JsonPropertyName("path")] public string Path { get; set; }
            [JsonPropertyName("value")] public string Value { get; set; }
        }

        /// <summary>
        /// game-files.json as Build-GameFiles.ps1 writes it: every game file in
        /// the package. setup-files.&lt;channel&gt;.json (Build-SetupFiles.ps1)
        /// is the same shape, for the files beside Game the install reads.
        /// </summary>
        public sealed class GameList
        {
            [JsonPropertyName("schema")] public int Schema { get; set; }
            [JsonPropertyName("commit")] public string Commit { get; set; }
            [JsonPropertyName("channel")] public string Channel { get; set; }
            [JsonPropertyName("from")] public string From { get; set; }
            [JsonPropertyName("files")] public GameFile[] Files { get; set; }
            /// <summary>game-files.json only: what the release no longer ships. Null in a setup list.</summary>
            [JsonPropertyName("gone")] public GoneFile[] Gone { get; set; }
        }

        /// <summary>
        /// The tag of the merge release that made <paramref name="v"/>
        /// (MergeRelease.ps1, THE NAMES). Throws for a version no merge
        /// release makes, so a package from anywhere else is never held to
        /// some other Release's record.
        /// </summary>
        public static string TagOf(SemanticVersion v)
        {
            if (v == null) throw new Exception("The update package has no version.");
            long year = v.Major, md = v.Minor, run = v.Patch;
            long month = md / 100, day = md % 100;
            if (year < 2000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || run < 1 || v.IsPrerelease)
                throw new Exception("The update package's version, " + v + ", is not one a Thornswood release makes, so there is no signed record to hold it to.");
            return "build-" + year.ToString("D4") + md.ToString("D4") + "." + run;
        }

        static string Download(string tag, string name)
        {
            return Velo.RepoUrl + "/releases/download/" + Uri.EscapeDataString(tag) + "/" + Uri.EscapeDataString(name);
        }

        // Through Http.cs, the launcher's one HttpClient, with the feed's ten
        // seconds for the answer to start and Http's own wait for each read;
        // these are files of a few kilobytes. The packages themselves go
        // through Velopack's own downloader.
        static byte[] Fetch(string tag, string name)
        {
            return FetchUrl(tag, name, tag);
        }

        // From the Release <paramref name="on"/>, for the record of <paramref name="tag"/>.
        static byte[] FetchUrl(string on, string name, string tag)
        {
            string url = Download(on, name);
            using (var req = new HttpRequestMessage(HttpMethod.Get, url))
            {
                req.Headers.TryAddWithoutValidation("User-Agent", "ThornswoodLauncher/" + Updater.Version);
                using (HttpResponseMessage r = Http.Send(req, 10000))
                {
                    if (!r.IsSuccessStatusCode)
                        throw new Exception("GitHub answered HTTP " + (int)r.StatusCode + " for " + name + " of " + tag + ".");
                    return Http.Body(r, Http.DefaultReadMs);
                }
            }
        }

        public static string Sha256(byte[] b)
        {
            return Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
        }

        public static string Sha256(Stream s)
        {
            return Convert.ToHexString(SHA256.HashData(s)).ToLowerInvariant();
        }

        // The records already read and passed this run, by tag. A record never
        // changes once its Release is published (Releases here are immutable),
        // so one read a run is enough.
        static readonly Dictionary<string, Manifest> held = new Dictionary<string, Manifest>(StringComparer.Ordinal);
        static readonly object heldGate = new object();

        /// <summary>
        /// The signed record of the Release that made <paramref name="v"/>,
        /// held to its signature: the catalog signed by Thornswood
        /// (Signature.Refusal, the check every launcher exe gets), the catalog
        /// listing manifest.json's sha256 as it arrived, and the manifest
        /// naming this repository, that tag and that version. Throws with the
        /// reason, as the rest of a sentence about the release record.
        /// </summary>
        public static Manifest Get(SemanticVersion v, out string said)
        {
            string tag = TagOf(v);
            said = "";
            lock (heldGate)
            {
                Manifest have;
                if (held.TryGetValue(tag, out have)) return have;
            }

            byte[] json = Fetch(tag, "manifest.json");
            byte[] cat = Fetch(tag, "manifest.cat");
            string catPath = Path.Combine(Path.GetTempPath(), "thornswood-velo-" + Guid.NewGuid().ToString("N") + ".cat");
            Manifest m;
            try
            {
                File.WriteAllBytes(catPath, cat);
                string signedSaid;
                string why = Signature.Refusal(catPath, Updater.ExpectedSigner, out signedSaid);
                if (why.Length > 0) throw new Exception("The release record of " + tag + ": its catalog " + why);
                string jsonSha = Sha256(json);
                if (!ReleaseManifest.CatalogDigests(catPath).Contains(jsonSha))
                    throw new Exception("The release record of " + tag + " is signed, but its catalog does not list manifest.json as it arrived (" + jsonSha + "), so the list was changed after it was signed.");
                m = JsonSerializer.Deserialize(json, VeloJson.Default.Manifest);
                said = "The release record of " + tag + " is signed. " + signedSaid;
            }
            finally
            {
                try { File.Delete(catPath); } catch (Exception ex) { Swallow.Note("VeloRecord.Get, delete the catalog", ex); }
            }
            if (m == null || m.Schema != 1 || m.Parts == null)
                throw new Exception("The release record of " + tag + " is not a manifest this launcher reads.");
            if (!string.Equals(m.Repo, Velo.Repo, StringComparison.OrdinalIgnoreCase))
                throw new Exception("The release record of " + tag + " names the repository " + m.Repo + ", not " + Velo.Repo + ".");
            if (!string.Equals(m.Tag, tag, StringComparison.Ordinal))
                throw new Exception("The release record fetched from " + tag + " says it is " + m.Tag + ".");
            if (!string.Equals(m.Version, v.ToString(), StringComparison.Ordinal))
                throw new Exception("The release record of " + tag + " is for version " + m.Version + ", not " + v + ".");
            lock (heldGate) held[tag] = m;
            return m;
        }

        /// <summary>
        /// Empty when the signed record of <paramref name="a"/>'s version lists
        /// it, by its file name and sha256, among the Velopack files of that
        /// Release. Otherwise why not. For Velopack's checksum step, so a
        /// package nobody signed for is refused before Velopack keeps it or
        /// takes its Update.exe out of it.
        /// </summary>
        public static string Vouches(VelopackAsset a)
        {
            if (a == null) return "is not named.";
            string said;
            Manifest m;
            try { m = Get(a.Version, out said); }
            catch (Exception ex) { return "could not be held to its release record: " + ex.Message; }
            PartFile f = m.File(PartOf("dev"), a.FileName) ?? m.File(PartOf("main"), a.FileName);
            if (f == null)
                return "is not among the Velopack files the signed release record of " + m.Tag + " lists.";
            if (!string.Equals(f.Sha256, a.SHA256, StringComparison.OrdinalIgnoreCase))
                return "is not the " + a.FileName + " the signed release record of " + m.Tag + " lists (" + f.Sha256 + ", and the feed says " + a.SHA256 + ").";
            return "";
        }

        /// <summary>
        /// game-files.json of the Release <paramref name="m"/> records, held
        /// to the sha256 the record gives it. Throws with the reason.
        /// </summary>
        public static GameList Game(Manifest m)
        {
            PartFile f = m.File("game", "game-files.json");
            if (f == null) throw new Exception("The release record of " + m.Tag + " lists no game-files.json, so the game files in the package cannot be held to a list.");
            byte[] raw = Fetch(m.Tag, "game-files.json");
            if (!string.Equals(Sha256(raw), f.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new Exception("game-files.json of " + m.Tag + " is not the one its signed release record lists.");
            GameList list = JsonSerializer.Deserialize(raw, VeloJson.Default.GameList);
            if (list == null || list.Schema != 1 || list.Files == null)
                throw new Exception("game-files.json of " + m.Tag + " is not a list this launcher reads.");
            if (!string.Equals(list.Commit, m.Commit, StringComparison.OrdinalIgnoreCase))
                throw new Exception("game-files.json of " + m.Tag + " was built from " + list.Commit + ", and the release from " + m.Commit + ".");
            return list;
        }

        /// <summary>
        /// The record's part that holds a channel's Velopack files: "velopack"
        /// for dev, published with the merge release, and "main" for main,
        /// held back until Patrick approves a promotion to main (#5181,
        /// merge-release.yml and promote-main.yml).
        /// </summary>
        public static string PartOf(string channel)
        {
            return channel == "main" ? "main" : "velopack";
        }

        /// <summary>
        /// setup-files.&lt;channel&gt;.json of the Release <paramref name="m"/>
        /// records, among that channel's Velopack files, held to the sha256
        /// the record gives it: the files beside Game the install reads on the
        /// first start (Build-SetupFiles.ps1), which differ by channel in
        /// config.json and applied.txt. Fetched from the build's own Release
        /// for dev; main's sits on main's Release, which serves its package.
        /// Throws with the reason.
        /// </summary>
        public static GameList Setup(Manifest m, string channel)
        {
            string name = "setup-files." + channel + ".json";
            PartFile f = m.File(PartOf(channel), name);
            if (f == null) throw new Exception("The release record of " + m.Tag + " lists no " + name + ", so the files beside the game files in the package cannot be held to a list.");
            byte[] raw = channel == "main" ? FetchUrl(MainRelease(m.Tag), name, m.Tag) : Fetch(m.Tag, name);
            if (!string.Equals(Sha256(raw), f.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new Exception(name + " of " + m.Tag + " is not the one its signed release record lists.");
            GameList list = JsonSerializer.Deserialize(raw, VeloJson.Default.GameList);
            if (list == null || list.Schema != 1 || list.Files == null || !string.Equals(list.Channel, channel, StringComparison.Ordinal))
                throw new Exception(name + " of " + m.Tag + " is not a list this launcher reads.");
            if (!string.Equals(list.Commit, m.Commit, StringComparison.OrdinalIgnoreCase))
                throw new Exception(name + " of " + m.Tag + " was built from " + list.Commit + ", and the release from " + m.Commit + ".");
            return list;
        }

        /// <summary>
        /// The tag of the Release main's files go out on (#5181): main- and
        /// the build's tag. A promotion to main puts it out once Patrick
        /// approves it (.github/workflows/promote-main.yml), and the build's
        /// own Release never carries them, so nothing reaches a main launcher
        /// unapproved.
        /// </summary>
        public static string MainRelease(string buildTag)
        {
            return "main-" + buildTag;
        }
    }

    /// <summary>
    /// The JSON the Velopack update reads, compiled when the launcher builds
    /// (no reflection, so it works in the native build): the release record,
    /// the game and setup lists, and GitHub's list of Releases (VeloUpdate.cs).
    /// </summary>
    [JsonSerializable(typeof(VeloRecord.Manifest))]
    [JsonSerializable(typeof(VeloRecord.GameList))]
    [JsonSerializable(typeof(List<GithubRelease>))]
    internal partial class VeloJson : JsonSerializerContext
    {
    }
}
