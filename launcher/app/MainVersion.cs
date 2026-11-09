using System;
using Velopack;
using Velopack.Logging;
using Velopack.Sources;

namespace Thornswood
{
    /// <summary>
    /// WHAT MAIN IS ON, ASKED OF MAIN (#2434, #5385). The dev News tab opens
    /// with "This is the dev build, on X. Main is on Y." Patrick, 12 Oct: "dev
    /// says main is on 1.2.3 even tho it's on 1.2.4 is there not a way to make
    /// this dynamic". So the tab asks main itself when it is shown
    /// (ShellNews.cs), and this is the asking.
    ///
    /// Until 9 Nov 2026 it asked main's version.json for launcherVersion.
    /// Since #4825 nothing writes that field: it stays at the last launcher
    /// from before Velopack (docs\FEED.md), so the tab named 1.2.16 while main
    /// ran 2026.x and then 1.3.x. A launcher goes out on main only as the
    /// package of a main Release (promote-main.yml), so main's number is the
    /// version of that package, and it is read where an update reads it: the
    /// newest Release that carries releases.main.json, through the same
    /// ChannelSource and ChannelRelease the update check uses (VeloUpdate.cs).
    /// One request to the site for the list of Releases and one download of
    /// that Release's feed through the site's Release route (#5608). The tab
    /// is opened by hand, so it is read each time rather than kept.
    /// </summary>
    static partial class Updater
    {
        /// <summary>Where the tab's answer comes from, in words for launcher.log.</summary>
        public const string MainSource = "main's newest Release on GitHub (releases.main.json)";

        /// <summary>
        /// The version of main's launcher package now. Throws with the reason
        /// when GitHub cannot be asked or main's newest Release carries no
        /// package, so the caller names only the dev build and says why.
        /// </summary>
        public static string MainLauncherVersion(Config cfg)
        {
            var source = new ChannelSource("main", 1);
            VelopackAssetFeed feed = source.GetReleaseFeed(new NullVelopackLogger(), "Thornswood", "main").GetAwaiter().GetResult();
            return MainVersionOf(feed == null ? null : feed.Assets);
        }

        /// <summary>
        /// Main's number out of main's feed as ChannelSource cut it: the
        /// highest full package left, which is the newest Release's own
        /// (ChannelRelease). Apart from the request so
        /// launcher\tests\test-2434-main-version-live.ps1 can hand it a feed.
        /// </summary>
        static string MainVersionOf(VelopackAsset[] assets)
        {
            VelopackAsset top = null;
            if (assets != null)
            {
                foreach (VelopackAsset a in assets)
                {
                    if (a == null || a.Type != VelopackAssetType.Full || a.Version == null) continue;
                    if (top == null || a.Version > top.Version) top = a;
                }
            }
            if (top == null) throw new Exception("main's newest Release carries no launcher package");
            return top.Version.ToString();
        }
    }
}
