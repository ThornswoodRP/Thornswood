using System;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// Where a caught exception goes when nothing is going to be done about
    /// it: one line in launcher.log, and nothing else.
    ///
    /// Measured on 24 Sep: 386 of the 618 catch clauses in tools\app had an
    /// empty body, so a failure in any of them left no trace at all. A tester
    /// says the Save button did nothing, and the log has no line to say why.
    /// This is the one line the catch can hold instead.
    ///
    /// It writes to Paths.LogFile directly and never goes through Shell.Log.
    /// Log is private, and its second line sets the status text, which from a
    /// pool thread throws, and that throw would be swallowed too. Nothing here
    /// touches a control, so it is safe from any thread.
    ///
    /// It never throws. The words for where it happened are built by the
    /// caller, before the call, so they are kept to plain strings that cannot
    /// throw either.
    /// </summary>
    static class Swallow
    {
        public static void Note(string where, Exception e)
        {
            try
            {
                string log = Paths.LogFile;
                if (string.IsNullOrEmpty(log)) return;
                File.AppendAllText(log,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  Swallowed in " + where + ": " +
                    (e == null ? "no exception given" : e.ToString()) + Environment.NewLine);
            }
            catch
            {
                // The log is the only place this could have gone, so there is
                // nowhere left to say it failed.
            }
        }

        /// <summary>
        /// One line in launcher.log for a failure that has a reason and no
        /// exception (#4350): a server that answered 404, a manifest with no
        /// mods in it. The same file, stamp and promise as Note: it touches no
        /// control and never throws.
        /// </summary>
        public static void Say(string where, string why)
        {
            try
            {
                string log = Paths.LogFile;
                if (string.IsNullOrEmpty(log)) return;
                File.AppendAllText(log,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  In " + where + ": " +
                    (string.IsNullOrEmpty(why) ? "no reason given" : why) + Environment.NewLine);
            }
            catch
            {
                // The log is the only place this could have gone, so there is
                // nowhere left to say it failed.
            }
        }
    }
}
