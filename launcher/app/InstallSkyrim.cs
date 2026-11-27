using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;

namespace Thornswood
{
    /// <summary>
    /// The install's first step: no Skyrim left running.
    ///
    /// Skyrim does not always exit when it looks like it has. A crash, an
    /// Alt-F4, or one of the multiplayer client's browser helpers leaves a
    /// process behind with no window, which nobody can see and nobody can
    /// close. It holds files open under the game, so it goes first.
    ///
    /// It is asked for politely, and only once its owner says so (#4705).
    /// CloseMainWindow is the window's own close button and a running game
    /// acts on it at once, so the open windows are named in a Yes or No box
    /// before it is sent; Kill is not a close button, and a program that ends somebody's
    /// game without a word is both rude and exactly the shape a behaviour
    /// scanner is built to flag. Five engines on VirusTotal flagged the setup
    /// stub on 27 September with nothing but machine learning verdicts behind
    /// it, and this was one of the two things it did that earned them
    /// (docs\VIRUSTOTAL-FALSE-POSITIVE.md). So anything still alive after the
    /// wait is named in a Yes or No box: Yes ends it, No stops the install
    /// having changed nothing.
    ///
    /// The waits are for the game's own exit, which a game that saves takes a
    /// moment over: Windows says when a process ends, and nothing is retried.
    /// </summary>
    static class InstallSkyrim
    {
        static readonly string[] Names = { "SkyrimSE", "skse64_loader" };

        /// <summary>
        /// Closes any Skyrim still running, asking before it ends one.
        /// <paramref name="askYesNo"/> puts the question in a Yes or No box
        /// and says whether the answer was Yes. Returns how many there were.
        /// </summary>
        public static int Stop(Func<string, bool> askYesNo)
        {
            var found = new List<Process>();
            foreach (string n in Names) found.AddRange(Process.GetProcessesByName(n));
            if (found.Count == 0) return 0;
            try
            {
                // Nothing reaches the game before its owner says so (#4705).
                // A close request is the window's own close button, and the
                // game acts on it at once: an unsaved game is gone the moment
                // it is sent. So the open windows are named first, No stops the
                // install with the game running and untouched, and only Yes
                // sends the request. A helper with no window has nothing to
                // close politely and goes straight to the question below.
                var windows = new List<Process>();
                foreach (Process p in found)
                    if (!p.HasExited && p.MainWindowHandle != IntPtr.Zero) windows.Add(p);
                if (windows.Count > 0)
                {
                    if (!askYesNo(CloseRequestQuestion(StillOpen(windows))))
                        throw new InstallStop(LeftOpen);
                    foreach (Process p in windows) p.CloseMainWindow();
                    // Up to six seconds, in all, for the game to close itself.
                    var clock = Stopwatch.StartNew();
                    foreach (Process p in windows)
                    {
                        int wait = 6000 - (int)clock.ElapsedMilliseconds;
                        if (wait <= 0) break;
                        p.WaitForExit(wait);
                    }
                }

                List<string> left = StillOpen(found);
                if (left.Count > 0)
                {
                    if (!askYesNo(CloseQuestion(left)))
                        throw new InstallStop(LeftOpen);
                    foreach (Process p in found)
                    {
                        if (p.HasExited) continue;
                        try { p.Kill(); }
                        catch (Exception e) when (e is Win32Exception || e is InvalidOperationException)
                        {
                            // Gone between the look and the kill, or not ours
                            // to end. Either way it is looked at again below.
                            if (!p.HasExited) throw new InstallStop("Skyrim (" + p.ProcessName + ") would not close: " + Failure.Why("InstallSkyrim, closing Skyrim", e, p.ProcessName) + ". Restart your PC, then run this again.");
                        }
                    }
                    foreach (Process p in found) p.WaitForExit(3000);
                    if (StillOpen(found).Count > 0)
                        throw new InstallStop("Skyrim would not close. Restart your PC, then run this again.");
                }
                return found.Count;
            }
            finally
            {
                foreach (Process p in found) p.Dispose();
            }
        }

        /// <summary>The names of the ones that are still running, each named once.</summary>
        static List<string> StillOpen(List<Process> all)
        {
            var names = new List<string>();
            foreach (Process p in all)
            {
                if (p.HasExited) continue;
                if (!names.Contains(p.ProcessName)) names.Add(p.ProcessName);
            }
            return names;
        }

        /// <summary>
        /// What the install says when it stops at No: nothing was installed and
        /// nothing of Skyrim's was touched.
        /// </summary>
        const string LeftOpen = "Skyrim is still open, so nothing was installed and nothing was " +
                                "closed for you. Close it yourself, check the taskbar and the " +
                                "system tray for anything of Skyrim's left behind, and run this " +
                                "again.";

        /// <summary>
        /// The first question, before anything is sent to the game: what is
        /// open, and that Yes asks it to close the way its own close button
        /// does.
        /// </summary>
        public static string CloseRequestQuestion(List<string> names)
        {
            return "Skyrim is open (" + string.Join(", ", names) + ").\n\n" +
                   "It holds the game files open, and the install cannot carry on while it is there.\n\n" +
                   "Ask it to close now?\n\n" +
                   "Yes closes it the way its own close button does, and anything not saved in the game is lost.\n" +
                   "No stops the install and changes nothing, so you can save and quit " +
                   "yourself, then run this again.";
        }

        /// <summary>
        /// The question: what is still running, why the install cannot carry
        /// on, and what each answer does.
        /// </summary>
        public static string CloseQuestion(List<string> names)
        {
            return "Skyrim is still running (" + string.Join(", ", names) + ").\n\n" +
                   "It may be the game itself, or a helper of it left behind by a crash, with " +
                   "no window of its own. It holds the game files open, and the " +
                   "install cannot carry on while it is there.\n\n" +
                   "Close it now?\n\n" +
                   "Yes ends it, and anything not saved in the game is lost.\n" +
                   "No stops the install and changes nothing, so you can save and quit " +
                   "yourself, then run this again.";
        }
    }
}
