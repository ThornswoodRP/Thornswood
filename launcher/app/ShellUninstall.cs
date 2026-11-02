using System;
using System.IO;
using System.Threading;
using Avalonia.Controls;
using Avalonia.Threading;

namespace Thornswood
{
    /// <summary>
    /// The launcher as Windows Settings opens it, from Uninstall under
    /// Installed apps.
    ///
    /// That button runs the exe with -uninstall, which is what Register.cs
    /// writes as UninstallString. Until 24 September the switch changed one
    /// thing, the page the window opened on, and everything else ran as if the
    /// person had opened the launcher to play: the update check, the server
    /// scan and the ping every half minute, the client repair that can
    /// download into the very game folder about to be deleted, voice, the
    /// Installed apps entry written again on the way out, the last session's
    /// logs sent, the game's INI files corrected, the own game folder offered
    /// or brought up to date, and the theme playing. All of it before the
    /// person reached the one button they came for, at the bottom of a page
    /// they then had to scroll. The To Do List put it as "Somebody who pressed
    /// Uninstall in Windows Settings should not watch a launcher start up and
    /// check for updates".
    ///
    /// It is still the real window, on the Settings page, and not a small
    /// window of its own. DoUninstall reads the two ticks and the button
    /// straight off that page with no null guard, so any other window throws
    /// on its first line. And the reason Settings opens the launcher at all,
    /// written above UninstallString in Register.cs, is that the uninstall
    /// asks two questions that matter and puts the Windows Skyrim folders back
    /// before it deletes anything. Both questions and that order live in
    /// DoUninstall and Uninstall.Begin, and neither is touched here.
    ///
    /// So Run makes the window, binds it, wires it and draws the Settings
    /// page and its folder rows, then comes here instead of going on. Two
    /// things Wire starts are stood down below before the window's message
    /// loop has run once, so neither ever fires: the two second timer, which
    /// pings the server and watches for the game, and the own game folder
    /// check on first draw. Wire skips the voice service's health probe and
    /// StartMenuMusic skips the theme, both on askedToUninstall. Play stays
    /// shut, because nothing has said this build is current, which is where
    /// updatePending starts.
    ///
    /// tests\test-uninstall-entry.js walks everything this path can reach and
    /// fails if any of that startup work comes back into it.
    /// </summary>
    static partial class Shell
    {
        static void OpenForUninstall()
        {
            if (timer != null) timer.Stop();
            ownGameStarted = true;

            // The game may still be up from a session. The Closing handler
            // Wire added reads this, the same as it does after a normal start:
            // closing this window without uninstalling asks first, and leaves
            // other servers' plugins parked rather than handing them back to a
            // running game. The uninstall itself closes the game before it
            // removes anything.
            playing = Checks.GameRunning();

            ShowPage(PageSettings);
            Log("Opened to uninstall, so the launcher did not check for updates, test the server or start anything else. Uninstall is at the bottom of this page.");

            // The last thing on a long page. Scrolled to once the page has been
            // laid out, since before then there is nothing to scroll. Not
            // focused, because then Enter would press it.
            OnceOnScreen(delegate
            {
                try { if (btnUninstall != null) btnUninstall.BringIntoView(); } catch (Exception ex) { Swallow.Note("Shell.OpenForUninstall, scrolling to Uninstall", ex); }
            });

            CentreOnMainScreen();

            // The same loop Run ends in, and for the same reason: tied to this
            // window, so closing it ends the loop, Main returns and the mutex
            // goes. Nothing to do on the way out, because nothing was started
            // that needs stopping: no voice, no presence, no files held.
            Dispatcher.UIThread.UnhandledException += delegate (object faultSender,
                DispatcherUnhandledExceptionEventArgs fault)
            {
                try { Log("Fault on the launcher's own thread: " + fault.Exception.GetType().Name + ": " + fault.Exception.Message); } catch (Exception ex) { Swallow.Note("Shell.OpenForUninstall, writing a fault to the status line", ex); }
                try { File.AppendAllText(Paths.LogFile, fault.Exception.ToString() + Environment.NewLine); }
                catch
                {
                    // The log is the one place this could have gone, and it is
                    // the log that failed, so there is nowhere left to say so.
                }
                fault.Handled = true;
            };
            StartStallWatch();
            using (var closed = new CancellationTokenSource())
            {
                win.Closed += delegate { closed.Cancel(); };
                win.Show();
                Dispatcher.UIThread.MainLoop(closed.Token);
            }
        }
    }
}
