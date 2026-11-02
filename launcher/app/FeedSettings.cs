using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// VERSION.JSON IN TWO (#1050, Patrick's answer of 19 Oct). The launcher
    /// reads the feed on every check, every thirty seconds while the game
    /// runs, and on 19 Oct main's was 4,928 bytes of which almost nothing
    /// changes between releases. So the publisher can keep in version.json
    /// only what the update check itself needs (the launcher's version,
    /// address and sha256, minLauncher, the release record and the news file)
    /// and put every other field, the server and voice addresses, Discord, the
    /// Skyrim pin, the client runtime, the signed manifest, into one asset
    /// named by its sha256, "settings": { sha256 }. Every asset the feed names
    /// is named by its sha256 alone, and its address is the feed's own assets
    /// folder plus that (VersionDoc.ParseFeed with AssetsOf).
    ///
    /// The settings file is a feed itself, every field but the update ones,
    /// so VersionDoc.Join puts the two together and nothing that reads a
    /// VersionDoc needs to know which file a field came from. It is fetched
    /// only when its sha256 is not the one in memory or in
    /// Profile\feed-settings.json, so a check whose settings did not move
    /// downloads version.json alone.
    ///
    /// Not cosmetic like the news file: a feed that names settings this
    /// launcher cannot have is a feed it cannot read, and the check fails
    /// with the reason, the way an unreadable version.json does. Every
    /// launcher before this reads only version.json, which is why the
    /// publisher splits it only once the channel's minLauncher reads the file
    /// (Feed-Json.ps1, $FeedSplitLauncher). Those launchers are below
    /// minLauncher then, and version.json still gives them what they need to
    /// update themselves: the launcher fields, and "packs" and "news" as the
    /// empty lists they have always read.
    /// </summary>
    static partial class Updater
    {
        static readonly object settingsLock = new object();
        static string settingsHeld = "";
        static byte[] settingsBytes;

        static string SettingsCacheFile
        {
            get { return string.IsNullOrEmpty(Paths.ProfileDir) ? null : Path.Combine(Paths.ProfileDir, "feed-settings.json"); }
        }

        /// <summary>
        /// The assets folder beside a feed: its address up to its name, plus
        /// "assets/". "" for an address that has no folder.
        /// </summary>
        public static string AssetsOf(string feedUrl)
        {
            string u = feedUrl == null ? "" : feedUrl.Trim();
            int q = u.IndexOfAny(new[] { '?', '#' });
            if (q >= 0) u = u.Substring(0, q);
            int slash = u.LastIndexOf('/');
            if (slash < 0 || u.IndexOf("://", StringComparison.Ordinal) < 0 || slash < u.IndexOf("://", StringComparison.Ordinal) + 3) return "";
            return u.Substring(0, slash + 1) + "assets/";
        }

        /// <summary>
        /// version.json as it arrived from feedUrl, read whole: with the
        /// settings file it names joined in. fetchWith null reads that file
        /// only from memory or Profile, for the copy of the feed kept on disk,
        /// and throws when it is not there. Throws when the settings cannot be
        /// had, do not match their sha256, or do not read.
        /// </summary>
        static VersionDoc ReadFeed(byte[] body, string feedUrl, Config fetchWith)
        {
            string assets = AssetsOf(feedUrl);
            VersionDoc top = VersionDoc.ParseFeed(body, assets.Length > 0 ? assets : null);
            if (top == null || top.settingsRef == null) return top;
            if (top.settingsRef.sha256.Length == 0)
                throw new Exception("The update feed names its settings file without a checksum, so it cannot be read.");
            if (assets.Length == 0)
                throw new Exception("The update feed names a settings file, but its own address has no folder to find it in.");
            VersionDoc rest = VersionDoc.ParseFeed(SettingsFile(fetchWith, assets, top.settingsRef.sha256), assets);
            if (rest == null) throw new Exception("The update feed's settings file did not read.");
            return VersionDoc.Join(top, rest);
        }

        /// <summary>
        /// The settings file's bytes, from memory, from Profile when that is
        /// the same file, or downloaded and kept there. Its address is the
        /// feed's folder, already checked by the caller, plus 64 hex
        /// characters, so it cannot be anywhere else.
        /// </summary>
        static byte[] SettingsFile(Config fetchWith, string assets, string sha)
        {
            lock (settingsLock)
            {
                if (settingsBytes != null && settingsHeld == sha) return settingsBytes;
            }
            byte[] raw = null;
            string cache = SettingsCacheFile;
            if (cache != null && File.Exists(cache))
            {
                byte[] had = File.ReadAllBytes(cache);
                if (ShaOf(had) == sha) raw = had;
            }
            if (raw == null)
            {
                if (fetchWith == null) throw new Exception("The update feed's settings file is not on this machine.");
                string url = assets + sha;
                raw = FeedGet(fetchWith, true, url);
                if (ShaOf(raw) != sha)
                    throw new Exception("The update feed's settings file did not match its checksum, so it was not read.");
                if (cache != null) OwnGame.WriteRecord(cache, raw);
            }
            lock (settingsLock)
            {
                settingsBytes = raw;
                settingsHeld = sha;
            }
            return raw;
        }

        /// <summary>The sha256 of b, in lower case hex.</summary>
        static string ShaOf(byte[] b)
        {
            using (var h = SHA256.Create())
            {
                byte[] d = h.ComputeHash(b);
                var sb = new StringBuilder();
                foreach (byte x in d) sb.Append(x.ToString("x2"));
                return sb.ToString();
            }
        }
    }
}
