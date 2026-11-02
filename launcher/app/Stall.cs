using System;
using System.IO;
using System.Threading;
using Avalonia.Threading;

namespace Thornswood
{
    /// <summary>
    /// Saying so in the log when the window stops answering.
    ///
    /// On 16 Sep Windows closed this launcher three times for not responding
    /// (15:13, 16:27 and 19:06, event 1002 in the Application log), each time
    /// while the game was running. Closing a stuck Skyrim was one wait on the
    /// window's thread and goes through Waiting now. Whatever else held it
    /// during those sessions left nothing in launcher.log, because the thing
    /// that writes the log was the thing that was stuck.
    /// </summary>
    static partial class Shell
    {
        /// <summary>The last line Log wrote, for the stall report.</summary>
        static volatile string lastLogged = "";

        /// <summary>What the window's thread is waiting on, if anything, for the stall report.</summary>
        static volatile string stallDoing;

        /// <summary>Set by the stall watch, cleared by the window thread's answer.</summary>
        static volatile bool stallReported;

        /// <summary>
        /// A thread of its own that asks the window thread to answer once a
        /// second. When no answer comes for five seconds, one line goes in the
        /// log saying what the launcher was doing, and another when it answers
        /// again. Written straight to the file, because Log runs on the thread
        /// that is stuck.
        /// </summary>
        static void StartStallWatch()
        {
            var t = new Thread(delegate()
            {
                long posted = 0;
                while (true)
                {
                    Thread.Sleep(1000);
                    try
                    {
                        long now = DateTime.UtcNow.Ticks;
                        long was = Interlocked.Read(ref posted);
                        if (was == 0)
                        {
                            Interlocked.Exchange(ref posted, now);
                            Dispatcher.UIThread.Post(delegate
                            {
                                long asked = Interlocked.Exchange(ref posted, 0);
                                if (stallReported)
                                {
                                    stallReported = false;
                                    double secs = (DateTime.UtcNow.Ticks - asked) / (double)TimeSpan.TicksPerSecond;
                                    Stamp("The launcher window is responding again after " + (int)secs + " seconds.");
                                }
                            }, DispatcherPriority.Normal);
                            continue;
                        }
                        double waited = (now - was) / (double)TimeSpan.TicksPerSecond;
                        if (!stallReported && waited >= 5)
                        {
                            stallReported = true;
                            string doing = stallDoing;
                            Stamp("The launcher window has not responded for " + (int)waited + " seconds. " +
                                  (string.IsNullOrEmpty(doing) ? "Nothing was marked as running." : "It was " + doing + ".") +
                                  " The last line before this was: " + lastLogged);
                        }
                    }
                    catch (Exception ex) { Swallow.Note("Shell.StartStallWatch", ex); }
                }
            });
            t.IsBackground = true;
            t.Name = "Stall watch";
            t.Start();
        }

        static void Stamp(string m)
        {
            for (int i = 0; i < 3; i++)
            {
                try
                {
                    File.AppendAllText(Paths.LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + m + Environment.NewLine);
                    return;
                }
                catch { Thread.Sleep(50); }
            }
        }
    }
}
