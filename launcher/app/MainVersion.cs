using System;

namespace Thornswood
{
    /// <summary>
    /// WHAT MAIN IS ON, ASKED OF MAIN (#2434). The dev News tab opens with
    /// "This is the dev build, on X. Main is on Y." Y used to be mainVersion out
    /// of the dev feed as it was at the launcher's last update check, so a dev
    /// launcher left open from before a main Ship went on naming the old main.
    /// Patrick, 12 Oct: "dev says main is on 1.2.3 even tho it's on 1.2.4 is
    /// there not a way to make this dynamic". Measured that day: both feeds
    /// said 1.2.4 from 11:55 AM, and only the launcher's own copy was old.
    ///
    /// So the tab asks main's own feed when it is shown (ShellNews.cs), and
    /// this is the asking. It is a feed read like every other one: https to a
    /// host on the list (CheckUrl), the feed's request (FeedGet, through
    /// Http.cs) with its ten second wait and gzip, and VersionDoc.Parse. The feed itself carries no
    /// signature and no checksum to check, the same as the launcher's own feed;
    /// https to thornswood.net is what it is trusted on. It never touches the
    /// update check's cache (Updater.cs, cached), which holds this channel's
    /// feed, not main's.
    ///
    /// Main's feed is about 8 KB and the tab is opened by hand, so it is read
    /// whole each time rather than kept with its ETag the way the update check,
    /// which runs every thirty seconds in play, keeps its own.
    /// </summary>
    static partial class Updater
    {
        /// <summary>
        /// Main's launcherVersion, read from main's own feed now. Throws with
        /// the reason when the feed cannot be read or names no version, so the
        /// caller can fall back to the dev feed's copy and say why.
        /// </summary>
        public static string MainLauncherVersion(Config cfg)
        {
            CheckUrl(MainFeed);
            return MainVersionAt(cfg, MainFeed);
        }

        /// <summary>
        /// The read itself, apart from CheckUrl so
        /// launcher\tests\test-2434-main-version-live.ps1 can point it at a server of
        /// its own.
        /// </summary>
        static string MainVersionAt(Config cfg, string url)
        {
            VersionDoc doc = VersionDoc.Parse(FeedGet(cfg, false, url, true));
            string v = (doc == null || doc.launcherVersion == null) ? "" : doc.launcherVersion.Trim();
            if (v.Length == 0) throw new Exception("main's feed names no launcher version");
            return v;
        }
    }
}
