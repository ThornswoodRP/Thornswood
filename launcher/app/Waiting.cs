using System;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;

namespace Thornswood
{
    static partial class Shell
    {
        /// <summary>How many Waiting calls are still running.</summary>
        static int waitDepth;

        /// <summary>The window's cursor before the outermost wait put the wait cursor up.</summary>
        static Cursor cursorBeforeWait;

        /// <summary>
        /// Runs <paramref name="work"/> on a pool thread and keeps the window
        /// drawing until it is done, then carries on from the next line, the
        /// same as a plain call would. The window's controls are off for the
        /// wait, so nothing can be pressed twice.
        ///
        /// Closing a stuck Skyrim waits up to nine seconds for it to go, and
        /// that wait used to happen on the window's own thread. Windows calls
        /// a window that has not answered for five seconds not responding and
        /// offers to close it. On 16 Sep it closed this launcher that way three
        /// times while the game was up (event 1002 in the Application log).
        ///
        /// Before the window is on screen there is nothing to keep drawing, and
        /// pumping messages that early would run queued startup work out of
        /// order, so the work simply runs.
        ///
        /// The wait cursor is the window's own. Avalonia has no cursor over
        /// the whole application the way WPF's Mouse.OverrideCursor was, and
        /// with the window's content off nothing under the pointer answers a
        /// hit test, so the window's cursor is the one shown everywhere on it.
        /// </summary>
        static void Waiting(Action work)
        {
            if (win == null || !win.IsVisible || !Dispatcher.UIThread.CheckAccess()) { work(); return; }

            Exception fault = null;
            var done = new ManualResetEvent(false);
            var frame = new DispatcherFrame();
            var content = win.Content as InputElement;
            bool wasEnabled = content != null && content.IsEnabled;

            waitDepth++;
            if (waitDepth == 1)
            {
                if (content != null) content.IsEnabled = false;
                cursorBeforeWait = win.Cursor;
                win.Cursor = new Cursor(StandardCursorType.Wait);
            }
            try
            {
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try { work(); }
                    catch (Exception ex) { fault = ex; }
                    finally
                    {
                        done.Set();
                        try { Dispatcher.UIThread.Post(delegate { frame.Continue = false; }); } catch (Exception ex) { Swallow.Note("Shell.Waiting, ending frame", ex); }
                    }
                });

                try { Dispatcher.UIThread.PushFrame(frame); }
                catch (InvalidOperationException ex) { Swallow.Note("Shell.Waiting, PushFrame", ex); }
                // PushFrame is refused while the dispatcher is suspended, during
                // layout for one. The work still finishes; wait for it plainly.
                done.WaitOne();
            }
            finally
            {
                waitDepth--;
                if (waitDepth == 0)
                {
                    if (content != null) content.IsEnabled = wasEnabled;
                    win.Cursor = cursorBeforeWait;
                    cursorBeforeWait = null;
                }
            }
            if (fault != null) throw new Exception(fault.Message, fault);
        }

        /// <summary>
        /// The answer of something Avalonia only offers as a task, such as
        /// Windows' own folder picker, taken on the window's thread the way a
        /// dialog's ShowDialog gave it: the window's messages keep moving
        /// until the task is done, then this carries on from the next line.
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
