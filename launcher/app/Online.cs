using System;

namespace Thornswood
{
    /// <summary>
    /// How many people are on the server right now.
    ///
    /// There is no way to ask a SkyMP server directly: its networking carries
    /// no status packet, and the first thing it will discuss is a connection.
    /// This used to read the old multiplayer mod's public server list, which is the
    /// right answer for a build that is not this one: SkyMP never reports to
    /// it, so the count sat at nothing forever and the Play page said so.
    ///
    /// The server does serve its own resources folder over HTTP, and the
    /// gamemode writes the count into it. So the answer comes from the server
    /// itself, over a port that is already open, with nothing new to install.
    /// </summary>
    static class Online
    {
        // The resources folder. Game traffic is UDP on its own port; this is
        // the little HTTP server beside it.
        public class Count
        {
            public bool Known;      // false when the server has not said yet
            public int Now;
            public int Max;
        }

        static Count cached;
        static DateTime cachedAt = DateTime.MinValue;

        /// <summary>
        /// Blocking. Call it off the UI thread. The answer is cached for a few
        /// seconds, because nobody needs this more often than that.
        /// </summary>
        public static Count Ask(Config cfg)
        {
            if (cached != null && (DateTime.UtcNow - cachedAt).TotalSeconds < 10) return cached;
            Count got = AskPort(cfg, SkyMp.ResourcePortFor(cfg), cfg != null && cfg.MaxOnline > 0 ? cfg.MaxOnline : 0);
            cached = got;
            cachedAt = DateTime.UtcNow;
            return got;
        }

        /// <summary>
        /// Who is awake on the other build's server (Main from Dev, or Dev from
        /// Main). Not cached with Ask, so the dropdown can refresh both sides.
        /// </summary>
        public static Count AskOther(Config cfg)
        {
            if (cfg == null) return new Count();
            int mine = SkyMp.ResourcePortFor(cfg);
            // Main resources are on 3000; Dev is game-port+1 (7788 when Dev is 7787).
            int other = mine == 3000 ? 7788 : 3000;
            // No fallback number: cfg.MaxOnline is this build's own feed's,
            // and main and dev seat differently since 12 Oct (30 and 5), so
            // the other server's number is only ever the one it announces.
            return AskPort(cfg, other, 0);
        }

        // fallbackMax is the feed's copy of this server's seats, shown until
        // the server says its own.
        static Count AskPort(Config cfg, int resourcePort, int fallbackMax)
        {
            var got = new Count();
            got.Max = fallbackMax;
            try
            {
                if (cfg != null && !string.IsNullOrEmpty(cfg.ServerAddress) && resourcePort > 0)
                {
                    string url = "http://" + cfg.ServerAddress + ":" + resourcePort + "/online.json";
                    // A server that is up but has not written the file yet
                    // should not hold the page for thirty seconds: the answer
                    // has 2.5 seconds to start (Http).
                    byte[] raw = Http.GetOrNull(url, 2500, Http.DefaultReadMs);
                    if (raw != null)
                    {
                        int at = 0;
                        if (raw.Length >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF) at = 3;
                        string text = System.Text.Encoding.UTF8.GetString(raw, at, raw.Length - at);
                        var m = System.Text.RegularExpressions.Regex.Match(text, "\"now\"\\s*:\\s*(\\d+)");
                        if (m.Success)
                        {
                            got.Known = true;
                            got.Now = int.Parse(m.Groups[1].Value);
                        }
                        // The most the server holds at once, in its own
                        // words (#481), over the feed's copy of it.
                        var mx = System.Text.RegularExpressions.Regex.Match(text, "\"max\"\\s*:\\s*(\\d+)");
                        int most;
                        if (mx.Success && int.TryParse(mx.Groups[1].Value, out most) && most > 0) got.Max = most;
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("Online.AskPort", ex); }
            return got;
        }

        /// <summary>What to put on the Play page. Empty when there is nothing worth saying.</summary>
        public static string Line(Count c)
        {
            if (c == null) return "";
            if (c.Known) return c.Now + (c.Max > 0 ? " of " + c.Max : "") + " awake";
            if (c.Max > 0) return "room for " + c.Max;
            return "";
        }
    }
}
