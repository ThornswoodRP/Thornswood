using System;
using System.Runtime.ExceptionServices;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;

namespace Thornswood
{
    static partial class Shell
    {
        /// <summary>How many OffThread waits are still running.</summary>
        static int waitDepth;

        /// <summary>The window's cursor before the outermost wait put the wait cursor up.</summary>
        static Cursor cursorBeforeWait;

        /// <summary>The window's content the outermost wait switched off, and whether it was on before.</summary>
        static InputElement heldContent;
        static bool heldContentWasEnabled;

        /// <summary>
        /// Runs <paramref name="work"/> on a pool thread, for the caller to
        /// await. The window's controls are off and the wait cursor is up
        /// until it is done, so nothing can be pressed twice.
        ///
        /// Closing a stuck Skyrim waits up to nine seconds for it to go, and
        /// that wait used to happen on the window's own thread. Windows calls
        /// a window that has not answered for five seconds not responding and
        /// offers to close it. On 16 Sep it closed this launcher that way three
        /// times while the game was up (event 1002 in the Application log).
        ///
        /// Until #4582 this was Waiting, which held its caller on the window's
        /// thread inside a nested Dispatcher.PushFrame and carried on from the
        /// next line, as a plain call would. Avalonia refuses that frame while
        /// the dispatcher is suspended, during layout for one, and the catch
        /// then waited with WaitOne on the window's thread: the launcher froze
        /// for as long as the work took. Awaited, the caller hands back to the
        /// window's own loop and comes back when the work is done, so there is
        /// no frame to refuse.
        ///
        /// Before the window is on screen there is nothing to keep drawing,
        /// and handing back that early would let queued startup work run out
        /// of order, so the work simply runs, and the task is done when this
        /// returns.
        ///
        /// The wait cursor is the window's own. Avalonia has no cursor over
        /// the whole application the way WPF's Mouse.OverrideCursor was, and
        /// with the window's content off nothing under the pointer answers a
        /// hit test, so the window's cursor is the one shown everywhere on it.
        /// </summary>
        static async Task OffThread(Action work)
        {
            if (!WindowUp()) { work(); return; }
            HoldWindow();
            try { await Task.Run(work); }
            finally { LetWindowGo(); }
        }

        /// <summary>The window is on screen and this is its thread.</summary>
        static bool WindowUp()
        {
            return win != null && win.IsVisible && Dispatcher.UIThread.CheckAccess();
        }

        /// <summary>
        /// The first of the waits running switches the window's content off
        /// and puts the wait cursor up. Waits can overlap without nesting
        /// (a bring-up-to-date's Fix starting while Play waits), so what the
        /// window was is kept here, not by each wait.
        /// </summary>
        static void HoldWindow()
        {
            waitDepth++;
            if (waitDepth > 1) return;
            heldContent = win.Content as InputElement;
            heldContentWasEnabled = heldContent != null && heldContent.IsEnabled;
            if (heldContent != null) heldContent.IsEnabled = false;
            cursorBeforeWait = win.Cursor;
            win.Cursor = new Cursor(StandardCursorType.Wait);
        }

        /// <summary>
        /// Set when an update closed the window while a wait ran (Shell.cs,
        /// win.Closing): the close is made again once the last wait ends.
        /// </summary>
        static bool closeWhenWaitsEnd;

        /// <summary>The last of the waits to end gives the window back as it was, or closes it for an update that is waiting (#6129).</summary>
        static void LetWindowGo()
        {
            waitDepth--;
            if (waitDepth > 0) return;
            if (heldContent != null) heldContent.IsEnabled = heldContentWasEnabled;
            heldContent = null;
            win.Cursor = cursorBeforeWait;
            cursorBeforeWait = null;
            if (closeWhenWaitsEnd)
            {
                closeWhenWaitsEnd = false;
                Dispatcher.UIThread.Post(delegate { win.Close(); });
            }
        }

        /// <summary>
        /// Starts an awaited path from something that cannot await it: a
        /// button, a callback, a line in startup. A path that has already
        /// ended, which is every path before the window is up, ends here the
        /// way a plain call did, so a fault in it throws to the caller and its
        /// own try and catch still sees it. A path still running hands back at
        /// once, and a fault it ends in later goes to the window's thread,
        /// where Dispatcher.UIThread.UnhandledException logs it and keeps the
        /// launcher up, as it did when Waiting threw it from there.
        /// </summary>
        static void Begin(Task path)
        {
            if (path.IsCompleted) { path.GetAwaiter().GetResult(); return; }
            path.ContinueWith(FaultToWindow, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
        }

        /// <summary>A path's fault, thrown again on the window's thread as it was first thrown.</summary>
        static void FaultToWindow(Task done)
        {
            ExceptionDispatchInfo fault = ExceptionDispatchInfo.Capture(done.Exception.InnerException);
            Dispatcher.UIThread.Post((Action)fault.Throw);
        }

        /// <summary>
        /// The answer of the install window at the first start (Shell.Run),
        /// before the launcher's own window and loop exist: this runs the
        /// application's message loop until the task is done, then Run carries
        /// on from the next line. Nothing else is running a loop then, so this
        /// one is not nested in another. Nothing in the window's own life uses
        /// it: there, a task is awaited (#4582). Until then Settings' Choose
        /// Vortex's folder took Windows' folder picker with this, a loop
        /// nested inside the button's click on the window's thread.
        /// launcher/tests/test-4582-await-not-pump.ps1 holds Shell.Run to
        /// being its only caller.
        /// </summary>
        static T Pump<T>(Task<T> task)
        {
            if (!task.IsCompleted)
            {
                using (var over = new CancellationTokenSource())
                {
                    task.ContinueWith(delegate { Dispatcher.UIThread.Post(over.Cancel); }, TaskScheduler.Default);
                    Dispatcher.UIThread.MainLoop(over.Token);
                }
            }
            return task.GetAwaiter().GetResult();
        }

        /// <summary>
        /// Runs once the window is first on screen and laid out, which is
        /// what WPF's ContentRendered was used for here. Avalonia has no such
        /// event: Opened comes as the window is shown, and work posted from
        /// it at background priority runs after the layout and drawing the
        /// showing queued.
        /// </summary>
        static void OnceOnScreen(Action then)
        {
            EventHandler shown = null;
            shown = delegate
            {
                win.Opened -= shown;
                Dispatcher.UIThread.Post(then, DispatcherPriority.Background);
            };
            win.Opened += shown;
        }
    }
}
