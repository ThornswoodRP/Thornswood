using System;
using System.Threading;
using System.Threading.Tasks;

namespace Thornswood
{
    // The real session and voice loop, with explicit gates standing in for
    // a delayed configuration callback and Windows audio setup/teardown.
    static class ShutdownCases
    {
        sealed class ObservedLoop : VoiceLoop
        {
            readonly VoiceThread thread = new VoiceThread();
            public readonly ManualResetEventSlim Finished = new ManualResetEventSlim();

            public override void Add(Action job) { thread.Add(job); }

            public override void Finish(Action last)
            {
                thread.Finish(delegate
                {
                    try { last(); }
                    finally { Finished.Set(); }
                });
            }
        }

        static VoiceSession Session(ObservedLoop loop, Action<string, string> host)
        {
            VoiceAudio.Last = null;
            VoiceAudio.Running = false;
            return new VoiceSession(host, new Config(), new VoiceSession.World
            {
                Loop = () => loop,
                Dial = (_, _, _) => throw new InvalidOperationException("this test does not use a socket")
            });
        }

        static void Configure(VoiceSession session) { session.Configure(1, "Fixture", "", "", ""); }

        static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        static void CloseDuringConfigure()
        {
            using var entered = new ManualResetEventSlim();
            using var release = new ManualResetEventSlim();
            var loop = new ObservedLoop();
            var session = Session(loop, (_, text) =>
            {
                if (!text.StartsWith("configured as profile ", StringComparison.Ordinal)) return;
                entered.Set();
                release.Wait();
            });
            try
            {
                Configure(session);
                Require(entered.Wait(5000), "configuration did not reach the test gate");
                Require(Task.Run(session.Dispose).Wait(4500), "closing waited indefinitely for configuration");
            }
            finally { release.Set(); }

            Require(loop.Finished.Wait(5000), "shutdown did not finish when configuration resumed");
            Require(VoiceAudio.Last == null, "configuration opened audio after close");
        }

        static void CloseDuringAudioStart()
        {
            using var entered = new ManualResetEventSlim();
            using var release = new ManualResetEventSlim();
            using var retired = new ManualResetEventSlim();
            var loop = new ObservedLoop();
            var session = Session(loop, (_, _) => { });
            VoiceAudio.BeforeStart = () => { entered.Set(); release.Wait(); };
            VoiceAudio.BeforeDispose = retired.Set;
            try
            {
                Configure(session);
                Require(entered.Wait(5000), "audio did not reach the Start gate");
                Require(Task.Run(session.Dispose).Wait(4500), "closing waited indefinitely for audio Start");
                Require(!retired.IsSet, "audio resources were retired while Start still owned them");
            }
            finally
            {
                release.Set();
                _ = loop.Finished.Wait(5000);
            }

            Require(loop.Finished.IsSet && retired.IsSet, "the queued teardown did not retire audio after Start returned");
        }

        static void CloseWhileAudioIsHeld()
        {
            using var started = new ManualResetEventSlim();
            using var entered = new ManualResetEventSlim();
            using var release = new ManualResetEventSlim();
            var loop = new ObservedLoop();
            var session = Session(loop, (_, _) => { });
            VoiceAudio.BeforeStart = started.Set;
            VoiceAudio.BeforeDispose = () => { entered.Set(); release.Wait(); };
            try
            {
                Configure(session);
                Require(started.Wait(5000), "audio did not start");
                var close = Task.Run(session.Dispose);
                Require(entered.Wait(5000), "audio shutdown did not start");
                Require(close.Wait(4500), "the caller stayed blocked while audio held its resources");
                Require(!loop.Finished.IsSet, "the session finished before its audio worker handed back its resources");
                Require(Task.Run(session.Dispose).Wait(1000), "a repeated close waited on the same held resources");
            }
            finally
            {
                release.Set();
                _ = loop.Finished.Wait(5000);
            }

            Require(loop.Finished.IsSet, "deferred teardown did not complete after audio returned");
        }

        public static int Run()
        {
            int failures = 0;
            foreach (Action test in new Action[] { CloseDuringConfigure, CloseDuringAudioStart, CloseWhileAudioIsHeld })
            {
                try { test(); Console.WriteLine("PASS  " + test.Method.Name); }
                catch (Exception ex) { failures++; Console.WriteLine("FAIL  " + test.Method.Name + ": " + ex.Message); }
                finally { VoiceAudio.BeforeStart = null; VoiceAudio.BeforeDispose = null; }
            }
            return failures == 0 ? 0 : 1;
        }
    }
}
