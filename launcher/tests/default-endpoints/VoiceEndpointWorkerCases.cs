using System;
using System.Collections.Concurrent;
using System.Threading;

namespace Thornswood
{
    static class VoiceEndpointWorkerCases
    {
        sealed class Stream : IVoiceEndpointStream
        {
            readonly AutoResetEvent ready = new AutoResetEvent(false);
            readonly Fixture fixture;
            readonly string id;

            public Stream(Fixture fixture, string id) { this.fixture = fixture; this.id = id; }
            public WaitHandle Ready => ready;
            public int Process()
            {
                fixture.Events.Enqueue("process " + id);
                return 0;
            }
            public void Dispose()
            {
                fixture.Events.Enqueue("dispose " + id);
                ready.Dispose();
            }
        }

        sealed class Endpoint : IVoiceEndpoint
        {
            readonly Fixture fixture;
            public string Id { get; }

            public Endpoint(Fixture fixture, string id) { this.fixture = fixture; Id = id; }
            public IVoiceEndpointStream Start(out int result)
            {
                fixture.Events.Enqueue("try " + Id);
                if (!(fixture.AllowStart?.Invoke(Id) ?? true))
                {
                    result = unchecked((int)0x80004005);
                    return null;
                }
                fixture.Events.Enqueue("start " + Id);
                result = 0;
                return new Stream(fixture, Id);
            }

            public void Dispose() { }
        }

        sealed class Fixture : IDisposable
        {
            public readonly ConcurrentQueue<string> Events = new ConcurrentQueue<string>();
            readonly DefaultEndpointChanges changes = new DefaultEndpointChanges();
            readonly ManualResetEvent stopping = new ManualResetEvent(false);
            readonly Thread worker;
            readonly int flow;
            readonly string pinned;
            public Func<string, bool> AllowStart { get; set; }
            string desired = "A";
            int resolved;
            Exception error;

            public Fixture(int flow, string pinned = null)
            {
                this.flow = flow;
                this.pinned = pinned;
                worker = new Thread(Run) { IsBackground = true };
            }

            public void Start() { worker.Start(); }
            public int Resolved => Volatile.Read(ref resolved);
        public void Stop() { stopping.Set(); }

            public void Default(string id, int role)
            {
                Volatile.Write(ref desired, id);
                changes.DefaultChanged(flow, role);
            }

            void Run()
            {
                try
                {
                    int status = VoiceEndpointWorker.Run(flow, stopping, changes, delegate
                    {
                        string id = pinned ?? Volatile.Read(ref desired);
                        Events.Enqueue("select " + id);
                        Interlocked.Increment(ref resolved);
                        return id == null ? null : new Endpoint(this, id);
                    }, _ => Events.Enqueue("replacement failed"));
                    if (status != 0) throw new InvalidOperationException("unexpected worker error " + status);
                }
                catch (Exception ex) { error = ex; }
            }

            public void Wait(string entry) { Require(SpinWait.SpinUntil(() => Has(entry), 5000), "missing " + entry); }
            public bool Has(string entry) { return Array.IndexOf(Events.ToArray(), entry) >= 0; }

            public void Dispose()
            {
                stopping.Set();
                Require(worker.Join(5000), "worker never stopped");
                stopping.Dispose();
                if (error != null) throw error;
            }
        }

        static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        static void Automatic(int flow, int role)
        {
            var fixture = new Fixture(flow);
            using (fixture)
            {
                fixture.Start();
                fixture.Wait("process A");
                fixture.Default("B", role);
                fixture.Wait("process B");
                string[] events = fixture.Events.ToArray();
                int start = Array.IndexOf(events, "start B");
                int oldClose = Array.IndexOf(events, "dispose A");
                Require(start >= 0 && oldClose > start, "old stream closed before replacement started");
                Require(!fixture.Has("dispose B"), "the new stream stopped while still active");
            }
            Require(fixture.Has("dispose B"), "shutdown did not retire the replacement");
        }

        static void Pinned(int flow, int role)
        {
            using var fixture = new Fixture(flow, "selected");
            fixture.Start();
            fixture.Wait("process selected");
            fixture.Default("B", role);
            Require(SpinWait.SpinUntil(() => fixture.Resolved >= 2, 5000), "the worker did not see the default change");
            Require(SpinWait.SpinUntil(delegate
            {
                string[] events = fixture.Events.ToArray();
                return Array.LastIndexOf(events, "process selected") > Array.LastIndexOf(events, "select selected");
            }, 5000), "explicit endpoint stopped processing after the default changed");
            Require(!fixture.Has("try B") && !fixture.Has("dispose selected"), "explicit endpoint was replaced by a Windows default");
        }

        static void RetainAndRetry()
        {
            using var canStart = new ManualResetEventSlim();
            using var fixture = new Fixture(VoiceCom.eCapture) { AllowStart = id => id == "A" || canStart.IsSet };
            fixture.Start();
            fixture.Wait("process A");
            fixture.Default(null, VoiceCom.eCommunications);
            Require(SpinWait.SpinUntil(() => fixture.Resolved >= 2, 5000), "the missing endpoint was not checked");
            Require(!fixture.Has("dispose A"), "missing default closed the old stream");
            fixture.Default("B", VoiceCom.eCommunications);
            fixture.Wait("replacement failed");
            int attempt = Array.IndexOf(fixture.Events.ToArray(), "try B");
            Require(SpinWait.SpinUntil(() => Array.LastIndexOf(fixture.Events.ToArray(), "process A") > attempt, 5000),
                "a failed replacement halted the old stream");
            Require(!fixture.Has("dispose A"), "failed replacement closed the old stream");

            canStart.Set();
            fixture.Wait("process B"); // No additional Windows notification.
            fixture.Wait("dispose A");
        }

        static void DuringOpen()
        {
            using var opening = new ManualResetEventSlim();
            using var canStart = new ManualResetEventSlim();
            using var fixture = new Fixture(VoiceCom.eRender)
            {
                AllowStart = id =>
                {
                    if (id != "B") return true;
                    opening.Set();
                    return canStart.Wait(5000);
                }
            };
            fixture.Start();
            fixture.Wait("process A");
            fixture.Default("B", VoiceCom.eConsole);
            try
            {
                Require(opening.Wait(5000), "replacement did not begin");
                Require(!fixture.Has("dispose A"), "pending replacement closed the active stream");
                fixture.Default("C", VoiceCom.eConsole);
            }
            finally { canStart.Set(); }
            fixture.Wait("process C");
            fixture.Wait("dispose B");
        }

        static void ShutdownDuringOpen()
        {
            using var opening = new ManualResetEventSlim();
            using var release = new ManualResetEventSlim();
            var fixture = new Fixture(VoiceCom.eCapture)
            {
                AllowStart = id =>
                {
                    if (id != "B") return true;
                    opening.Set();
                    return release.Wait(5000);
                }
            };
            using (fixture)
            {
                fixture.Start();
                fixture.Wait("process A");
                fixture.Default("B", VoiceCom.eCommunications);
                try
                {
                    Require(opening.Wait(5000), "replacement did not begin");
                    fixture.Stop();
                    Require(!fixture.Has("dispose A"), "old stream was released during outstanding native start");
                }
                finally { release.Set(); }
            }
            Require(fixture.Has("dispose A") && fixture.Has("dispose B") && !fixture.Has("process B"),
                "stop did not release both streams without processing another frame");
        }

        public static int Run()
        {
            int failed = 0;
            void Check(string name, Action execute)
            {
                try { execute(); Console.WriteLine("PASS " + name); }
                catch (Exception ex) { failed++; Console.WriteLine("FAIL " + name + ": " + ex.Message); }
            }
            Check("capture worker follows a new communications default before closing its old stream", () => Automatic(VoiceCom.eCapture, VoiceCom.eCommunications));
            Check("playback worker follows a new console default before closing its old stream", () => Automatic(VoiceCom.eRender, VoiceCom.eConsole));
            Check("capture worker leaves its explicitly selected microphone pinned", () => Pinned(VoiceCom.eCapture, VoiceCom.eCommunications));
            Check("playback worker leaves its explicitly selected output pinned", () => Pinned(VoiceCom.eRender, VoiceCom.eConsole));
            Check("worker keeps a usable stream through missing and failed replacement and retries without another event", RetainAndRetry);
            Check("worker handles another default change during replacement startup", DuringOpen);
            Check("worker stops safely during replacement startup", ShutdownDuringOpen);
            return failed;
        }
    }
}
