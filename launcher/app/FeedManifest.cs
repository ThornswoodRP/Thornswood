using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;

namespace Thornswood
{
    /// <summary>
    /// THE SIGNED RELEASE MANIFEST, CHECKED (#2163, phase C of
    /// docs\SIGNED-RELEASES.md). The feed names "signedManifest": release.json,
    /// the sha256 of every asset of the release that carries code or names
    /// files, and a catalog over it signed by ThornswoodRelease. On each update
    /// check that brings a feed with a different manifest or different assets,
    /// both files are fetched like every other asset (https to a host on the
    /// list, CheckUrl, stored under their own sha256, the bytes must hash to
    /// it) and ReleaseManifest.Refusal says whether every asset the feed names
    /// is one the signer released.
    ///
    /// Phase C only says so, in launcher.log, which reaches the site with a
    /// session's logs. A feed with no manifest, a manifest that fails, or one
    /// that cannot be had never stops an update or Play. Phase D refuses, once
    /// these lines have been read for one main and several dev releases.
    /// </summary>
    static partial class Updater
    {
        static readonly object manifestLock = new object();
        static string manifestSaid = "";

        /// <summary>
        /// The feed's assets the manifest must list, as (what, sha256): the
        /// launcher, the client runtime, each pack and optional pack, and the
        /// release record. The same list Release-Manifest.ps1 writes.
        /// </summary>
        public static List<KeyValuePair<string, string>> ManifestAssets(VersionDoc v)
        {
            var a = new List<KeyValuePair<string, string>>();
            if (v == null) return a;
            if (!string.IsNullOrEmpty(v.launcherUrl) && !string.IsNullOrEmpty(v.launcherSha256))
                a.Add(new KeyValuePair<string, string>("launcher " + v.launcherVersion, v.launcherSha256));
            if (v.clientRuntime != null && !string.IsNullOrEmpty(v.clientRuntime.url) && !string.IsNullOrEmpty(v.clientRuntime.sha256))
                a.Add(new KeyValuePair<string, string>("client runtime " + v.clientRuntime.forkCommit, v.clientRuntime.sha256));
            foreach (Pack[] list in new[] { v.packs, v.optional })
            {
                if (list == null) continue;
                foreach (Pack p in list)
                    if (p != null && !string.IsNullOrEmpty(p.url) && !string.IsNullOrEmpty(p.sha256))
                        a.Add(new KeyValuePair<string, string>("pack " + p.id, p.sha256));
            }
            if (v.record != null)
                a.Add(new KeyValuePair<string, string>("release record " + v.record.id, v.record.sha256));
            return a;
        }

        /// <summary>
        /// The line for launcher.log about this feed's signed manifest, or
        /// null when the same manifest over the same assets was already
        /// checked this run. Never throws.
        /// </summary>
        public static string ManifestLine(Config cfg, VersionDoc v)
        {
            if (v == null) return null;
            var assets = ManifestAssets(v);
            var key = new System.Text.StringBuilder();
            if (v.manifestRef != null) key.Append(v.manifestRef.sha256).Append(v.manifestRef.catalogSha256);
            foreach (var kv in assets) key.Append('|').Append(kv.Value);
            lock (manifestLock)
            {
                if (manifestSaid == key.ToString()) return null;
                manifestSaid = key.ToString();
            }

            if (v.manifestRef == null)
                return "This update feed names no signed release manifest, so its files are checked by their checksums alone.";

            string cat = null, json = null;
            try
            {
                cat = FetchAsset(cfg, v.manifestRef.catalogUrl, v.manifestRef.catalogSha256, ".cat");
                json = FetchAsset(cfg, v.manifestRef.url, v.manifestRef.sha256, ".json");
                string said;
                string why = ReleaseManifest.Refusal(cat, json, assets, ExpectedSigner, out said);
                if (why.Length == 0) return said;
                return "WARNING: the release manifest " + why + " Nothing was refused for it yet (#2163, phase C).";
            }
            catch (Exception ex)
            {
                return "WARNING: the release manifest could not be checked: " + ex.Message + " Nothing was refused for it yet (#2163, phase C).";
            }
            finally
            {
                foreach (string f in new[] { cat, json })
                    if (f != null) { try { File.Delete(f); } catch (Exception ex) { Swallow.Note("Updater.ManifestLine, delete " + f, ex); } }
            }
        }

        /// <summary>
        /// One small asset into a temp file: a url on the list, stored under
        /// its own sha256, and bytes that hash to it. Throws otherwise.
        /// </summary>
        static string FetchAsset(Config cfg, string url, string sha, string ext)
        {
            CheckUrl(url);
            string u = url;
            int q = u.IndexOfAny(new[] { '?', '#' });
            if (q >= 0) u = u.Substring(0, q);
            if (!u.EndsWith("/" + sha, StringComparison.OrdinalIgnoreCase))
                throw new Exception("The update feed names a manifest file that is not stored under its own checksum.");
            byte[] raw;
            raw = FeedGet(cfg, true, url);
            string got;
            using (var h = SHA256.Create()) got = BitConverter.ToString(h.ComputeHash(raw)).Replace("-", "").ToLowerInvariant();
            if (got != sha) throw new Exception("A manifest file did not match its checksum.");
            string tmp = Path.Combine(Path.GetTempPath(), "thornswood-manifest-" + Guid.NewGuid().ToString("N") + ext);
            File.WriteAllBytes(tmp, raw);
            return tmp;
        }
    }
}
