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
    /// It is asked for politely, and the last resort is asked about.
    /// CloseMainWindow is the window's own close button and a running game
    /// saves and exits on it; Kill is not, and a program that ends somebody's
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
                bool asked = false;
                foreach (Process p in found)
                {
                    if (p.HasExited || p.MainWindowHandle == IntPtr.Zero) continue;
                    p.CloseMainWindow();
                    asked = true;
                }
                if (asked)
                {
                    // Up to six seconds, in all, for the game to close itself.
                    var clock = Stopwatch.StartNew();
                    foreach (Process p in found)
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
                        throw new InstallStop("Skyrim is still open, so nothing was installed and nothing was " +
                                              "closed for you. Close it yourself, check the taskbar and the " +
                                              "system tray for anything of Skyrim's left behind, and run this " +
                                              "again.");
                    foreach (Process p in found)
                    {
                        if (p.HasExited) continue;
                        try { p.Kill(); }
                        catch (Exception e) when (e is Win32Exception || e is InvalidOperationException)
                        {
                            // Gone between the look and the kill, or not ours
                            // to end. Either way it is looked at again below.
                            if (!p.HasExited) throw new InstallStop("Skyrim (" + p.ProcessName + ") would not close: " + e.Message + ". Restart your PC, then run this again.");
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
