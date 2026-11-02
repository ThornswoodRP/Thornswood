using System;
using System.Globalization;

namespace Thornswood
{
    /// <summary>
    /// One report of how far a piece of work has got: the plain words for
    /// what it is doing (the phase), and whichever of bytes and files it can
    /// count. A total of 0 or less is a total nobody knows yet.
    /// </summary>
    public sealed class ProgressStep
    {
        public string Phase = "";
        public long BytesDone, BytesTotal;
        public long FilesDone, FilesTotal;
        /// <summary>What FilesDone counts, plural: "files", or "updates" for packs.</summary>
        public string Unit = "files";
        /// <summary>
        /// How far through, 0 to 1, when the counts alone would move in jumps:
        /// several downloads in one update, where FilesDone says which one and
        /// this carries the bytes of the one under way. Below 0: worked out
        /// from the counts.
        /// </summary>
        public double Fraction = -1;
    }

    /// <summary>
    /// What the Play button says and how full it is while the launcher works
    /// (#1145). Patrick, 29 Sep: "when the launcher is preparing the own game
    /// folder or doing an update I want a progress bar on the Play button and
    /// not just updating or preparing the game folder".
    ///
    /// No Avalonia in here, so launcher\tests\test-play-progress.ps1 can compile it on its
    /// own and drive it. Shell (ShellProgress.cs) paints it: it reads the
    /// state on a timer every DrawEveryMs, and only when something changed,
    /// so a download reporting every 80 KB or a check going through 2,500
    /// files does not make the button flicker or flood the window's thread.
    ///
    /// The rules it keeps:
    /// - Within one phase it never goes backwards. A report that would move
    ///   the fill or the count back is dropped, and a known total never turns
    ///   back into an unknown one.
    /// - A total nobody knows yet is a steady moving state (Fill below 0), and
    ///   the text says how much so far, or "..." when there is nothing to count.
    /// - A new phase starts from its own beginning.
    /// - Stop puts it away, and Caption then gives back whatever the button
    ///   would have said without it: Play, or the reason it is off.
    /// Every member locks, because reports come from pool threads.
    /// </summary>
    public sealed class PlayBar
    {
        /// <summary>How often the window redraws the button at most.</summary>
        public const int DrawEveryMs = 100;

        readonly object gate = new object();
        bool active, dirty;
        string phase = "", text = "";
        double fill;
        long amount;

        public bool Active { get { lock (gate) return active; } }
        public string Phase { get { lock (gate) return phase; } }
        public string Text { get { lock (gate) return text; } }
        /// <summary>0 to 1, or below 0 while the total is not known.</summary>
        public double Fill { get { lock (gate) return fill; } }

        /// <summary>Takes one report. Anything that would go backwards is dropped.</summary>
        public void Offer(ProgressStep s)
        {
            if (s == null) return;
            string ph = s.Phase ?? "";
            double f = FractionOf(s);
            long am = Math.Max(0, s.BytesDone) + Math.Max(0, s.FilesDone);
            lock (gate)
            {
                bool same = active && ph == phase;
                if (same)
                {
                    if (fill >= 0 && (f < 0 || f < fill)) return;
                    if (fill < 0 && f < 0 && am < amount) return;
                }
                string t = TextOf(s, f);
                if (same && t == text && Math.Abs(f - fill) < 0.0005) return;
                active = true;
                phase = ph;
                fill = f;
                text = t;
                amount = am;
                dirty = true;
            }
        }

        /// <summary>The work is over, finished or failed. The button goes back to what it was.</summary>
        public void Stop()
        {
            lock (gate)
            {
                if (!active) return;
                active = false;
                phase = "";
                text = "";
                fill = 0;
                amount = 0;
                dirty = true;
            }
        }

        /// <summary>True once after any change, for the redraw timer.</summary>
        public bool TakeDirty()
        {
            lock (gate)
            {
                bool d = dirty;
                dirty = false;
                return d;
            }
        }

        public bool Dirty { get { lock (gate) return dirty; } }

        /// <summary>The text for the button: this while it runs, otherwise what it would have said.</summary>
        public string Caption(string otherwise)
        {
            lock (gate) return active ? text : otherwise;
        }

        /// <summary>All three at once, so a redraw never mixes two reports.</summary>
        public void Read(out bool isActive, out string caption, out double fraction)
        {
            lock (gate)
            {
                isActive = active;
                caption = text;
                fraction = fill;
            }
        }

        /// <summary>0 to 1 from the counts, bytes before files, or -1 when neither total is known.</summary>
        public static double FractionOf(ProgressStep s)
        {
            if (s == null) return -1;
            if (s.Fraction >= 0) return Math.Min(1.0, s.Fraction);
            if (s.BytesTotal > 0) return Clamp((double)s.BytesDone / s.BytesTotal);
            if (s.FilesTotal > 0) return Clamp((double)s.FilesDone / s.FilesTotal);
            return -1;
        }

        static double Clamp(double d) { return d < 0 ? 0 : d > 1 ? 1 : d; }

        /// <summary>
        /// "Updating 42%, 310 of 740 MB", "Preparing the game folder 46%,
        /// 1,200 of 2,580 files", "Updating, 12 MB so far", "Checking files ...".
        /// </summary>
        public static string TextOf(ProgressStep s, double f)
        {
            string ph = s.Phase ?? "";
            string unit = string.IsNullOrEmpty(s.Unit) ? "files" : s.Unit;
            if (f < 0)
            {
                if (s.BytesDone > 0) return ph + ", " + Size(s.BytesDone, s.BytesDone) + " so far";
                if (s.FilesDone > 0) return ph + ", " + Count(s.FilesDone) + " " + unit + " so far";
                return ph + " ...";
            }
            // 100 only once it is all there, so a big download does not sit
            // at 100% for its last megabyte.
            int pct = (int)Math.Floor(f * 100);
            if (pct >= 100 && f < 1) pct = 99;
            string head = ph + " " + pct + "%, ";
            if (s.Fraction < 0 && s.BytesTotal > 0)
                return head + Amount(Math.Min(s.BytesDone, s.BytesTotal), s.BytesTotal) + " of " + Size(s.BytesTotal, s.BytesTotal);
            if (s.FilesTotal > 0)
                return head + Count(Math.Min(s.FilesDone, s.FilesTotal)) + " of " + Count(s.FilesTotal) + " " +
                       (s.FilesTotal == 1 && unit.EndsWith("s") ? unit.Substring(0, unit.Length - 1) : unit);
            return ph + " " + pct + "%";
        }

        static string Count(long n) { return n.ToString("n0", CultureInfo.InvariantCulture); }

        // The number alone, in the unit the total is written in.
        static string Amount(long bytes, long scale)
        {
            string s = Size(bytes, scale);
            return s.Substring(0, s.LastIndexOf(' '));
        }

        // KB under a megabyte, one decimal under ten, whole megabytes above.
        static string Size(long bytes, long scale)
        {
            const double Mb = 1048576.0;
            if (scale < 1048576) return Math.Ceiling(bytes / 1024.0).ToString("n0", CultureInfo.InvariantCulture) + " KB";
            if (scale < 10L * 1048576) return (Math.Floor(bytes / Mb * 10) / 10).ToString("0.0", CultureInfo.InvariantCulture) + " MB";
            return Math.Floor(bytes / Mb).ToString("n0", CultureInfo.InvariantCulture) + " MB";
        }
    }

    /// <summary>
    /// Where the work reports to (#1145). The Updater, the release sync,
    /// OwnGame and Verify call this from whatever thread they are on; Shell
    /// sets Sink to its PlayBar. Nothing is passed on outside Begin and End,
    /// so the same code run by Fix, Scan or a check before Play (where the
    /// button is not waiting on it) says nothing to the button.
    ///
    /// Downloads: Plan says how many a stage of an update will make, and each
    /// download reports its bytes through Part and PartDone. One download
    /// shows its bytes against its size; several show which one of how many,
    /// with the fill moving through the one under way, so the fill never
    /// starts again at the next pack.
    ///
    /// Two pieces of work at once (#2210): an update may download while the
    /// game folder is prepared. The button shows the folder: while it is
    /// prepared (FolderFirst), what a thread marked Second reports (the
    /// update's) is counted but not shown, and the update shows itself again
    /// with its next report once the folder is done.
    /// </summary>
    public static class PlayProgress
    {
        public static Action<ProgressStep> Sink;

        static readonly object gate = new object();
        static int open;
        static bool folderFirst;
        [ThreadStatic] static bool second;

        /// <summary>The game folder is being made or prepared, so the button is its own.</summary>
        public static void FolderFirst(bool on) { lock (gate) folderFirst = on; }

        /// <summary>This thread's work is second to the folder's: an update beside a refresh. Set back to false when it ends.</summary>
        public static void Second(bool on) { second = on; }

        /// <summary>True when this thread's reports are kept off the button right now.</summary>
        static bool Quiet { get { lock (gate) return second && folderFirst; } }
        static string partPhase = "", partUnit = "updates";
        static int parts, partsDone;

        /// <summary>Work that holds the Play button starts. Pairs with End.</summary>
        public static void Begin(string phase, int downloads)
        {
            lock (gate) open++;
            Plan(phase, downloads, "updates");
        }

        /// <summary>The next stage of the work under way, with the downloads it will make (0 for none).</summary>
        public static void Plan(string phase, int downloads, string unit)
        {
            lock (gate)
            {
                if (open == 0) return;
                partPhase = phase ?? "";
                partUnit = string.IsNullOrEmpty(unit) ? "updates" : unit;
                parts = Math.Max(0, downloads);
                partsDone = 0;
            }
            if (!Quiet) Send(new ProgressStep { Phase = phase ?? "" });
        }

        /// <summary>The work is over. The last End puts the button back.</summary>
        public static void End()
        {
            bool last;
            lock (gate)
            {
                if (open == 0) return;
                open--;
                last = open == 0;
                if (last) { parts = 0; partsDone = 0; }
            }
            if (last) Send(null);
        }

        public static bool Open { get { lock (gate) return open > 0; } }

        public static void Report(string phase, long bytesDone, long bytesTotal, long filesDone, long filesTotal, string unit)
        {
            if (!Open || Quiet) return;
            Send(new ProgressStep
            {
                Phase = phase ?? "",
                BytesDone = bytesDone, BytesTotal = bytesTotal,
                FilesDone = filesDone, FilesTotal = filesTotal,
                Unit = string.IsNullOrEmpty(unit) ? "files" : unit
            });
        }

        public static void Files(string phase, long done, long total) { Report(phase, 0, 0, done, total, "files"); }

        public static void Bytes(string phase, long done, long total) { Report(phase, done, total, 0, 0, "files"); }

        /// <summary>A download under way: bytes so far, and its size (0 or less when the server did not say).</summary>
        public static void Part(long got, long length)
        {
            ProgressStep s;
            lock (gate)
            {
                if (open == 0 || parts == 0 || partsDone >= parts) return;
                s = new ProgressStep { Phase = partPhase };
                if (parts == 1)
                {
                    s.BytesDone = got;
                    s.BytesTotal = length > 0 ? length : 0;
                }
                else
                {
                    double within = length > 0 ? Math.Min(1.0, (double)got / length) : 0;
                    s.FilesDone = partsDone;
                    s.FilesTotal = parts;
                    s.Unit = partUnit;
                    s.Fraction = (partsDone + within) / parts;
                }
            }
            if (!Quiet) Send(s);
        }

        /// <summary>A download finished.</summary>
        public static void PartDone()
        {
            ProgressStep s = null;
            lock (gate)
            {
                if (open == 0 || parts == 0 || partsDone >= parts) return;
                partsDone++;
                if (parts > 1)
                    s = new ProgressStep { Phase = partPhase, FilesDone = partsDone, FilesTotal = parts, Unit = partUnit };
            }
            if (s != null && !Quiet) Send(s);
        }

        static void Send(ProgressStep s)
        {
            Action<ProgressStep> k = Sink;
            if (k == null) return;
            try { k(s); }
            catch (Exception ex) { Swallow.Note("PlayProgress, the Play button", ex); }
        }
    }
}
