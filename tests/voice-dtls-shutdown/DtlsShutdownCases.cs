using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Org.BouncyCastle.Tls;
using SharpSRTP.DTLS;

namespace Thornswood
{
    public static class DtlsShutdownCases
    {
        const BindingFlags Hidden = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        static readonly List<object> checks = new List<object>();
        static int failed;
        static object Get(object o, string name) { return o.GetType().GetField(name, Hidden).GetValue(o); }
        static void Set(object o, string name, object value) { o.GetType().GetField(name, Hidden).SetValue(o, value); }
        static void Check(string name, bool ok)
        {
            checks.Add(new { name, ok });
            if (!ok) failed++;
        }
        static bool Wait(Func<bool> done, int ms = 4000)
        {
            var clock = Stopwatch.StartNew();
            while (clock.ElapsedMilliseconds < ms) { if (done()) return true; Thread.Sleep(10); }
            return done();
        }
        static object Layer(VoicePeer p) { return Get(((BcDtlsTransport)Get(p, "dtls")).Transport, "m_recordLayer"); }
        static bool IsFailed(object layer) { return (bool)layer.GetType().GetProperty("IsFailed", Hidden).GetValue(layer); }

        sealed class Pair : IDisposable
        {
            public readonly VoicePeer A = new VoicePeer(2, true, new VoiceMix());
            public readonly VoicePeer B = new VoicePeer(1, false, new VoiceMix());
            public readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
            public Pair()
            {
                A.Debug = m => Lines.Enqueue("A " + m); B.Debug = m => Lines.Enqueue("B " + m);
                A.OnCandidate = c => B.AddCandidate(c, A.LocalUfrag);
                B.OnCandidate = c => A.AddCandidate(c, B.LocalUfrag);
                A.SetRemote(B.Description()); B.SetRemote(A.Description());
                A.Gather(new List<IceServer>()); B.Gather(new List<IceServer>());
                // Production gathering deliberately does not advertise loopback.
                // The local fixture supplies each actual bound ephemeral port.
                A.AddCandidate("candidate:1 1 udp 2130706431 127.0.0.1 " + Get(Get(B, "ice"), "port") + " typ host", B.LocalUfrag);
                B.AddCandidate("candidate:1 1 udp 2130706431 127.0.0.1 " + Get(Get(A, "ice"), "port") + " typ host", A.LocalUfrag);
                if (!Wait(() => Get(A, "srtp") != null && Get(B, "srtp") != null, 10000))
                    throw new InvalidOperationException("actual loopback DTLS pair did not secure");
                Check("both native sockets are loopback only", IPAddress.IsLoopback((IPAddress)Get(Get(A, "ice"), "bound")) &&
                    IPAddress.IsLoopback((IPAddress)Get(Get(B, "ice"), "bound")));
            }
            public void Dispose()
            {
                A.Dispose(); B.Dispose();
            }
        }

        sealed class BeforeReceive
        {
            public int Calls;
            public volatile bool Called;
            public readonly ManualResetEventSlim Entered = new ManualResetEventSlim();
            public readonly ManualResetEventSlim Release = new ManualResetEventSlim();
            public readonly ManualResetEventSlim Stopped = new ManualResetEventSlim();
        }
        static volatile BeforeReceive beforeReceive;

        // The JS compile adapter routes the unchanged native call here. Park
        // before entering BouncyCastle, so no library deadline has started.
        public static int ReceiveAfterGate(int id, IDtlsTransport transport, byte[] buffer, int offset, int length, int wait)
        {
            var gate = beforeReceive;
            if (id == 2 && gate != null && Interlocked.Increment(ref gate.Calls) == 1)
            {
                gate.Entered.Set();
                if (!gate.Release.Wait(10000)) throw new TimeoutException("fixture before-receive barrier");
                gate.Called = true;
            }
            return transport.Receive(buffer, offset, length, wait);
        }

        public static bool ReadAgain(int id, bool closed)
        {
            if (id == 2 && closed) beforeReceive?.Stopped.Set();
            return !closed;
        }

        [ThreadStatic]
        static bool waitedOnOpenInput;

        public static bool TakeDatagram(BlockingCollection<byte[]> input, out byte[] packet, int wait)
        {
            // Call the actual queue operation with the unmodified timeout.
            waitedOnOpenInput = wait > 0 && !input.IsAddingCompleted;
            return input.TryTake(out packet, wait);
        }

        // Count untimed empty results, which would make the library busy-loop.
        // The library can legitimately read the transport more than once.
        sealed class ReadBarrier : DatagramTransport
        {
            readonly DatagramTransport inner;
            int reads;
            int untimedEmptyReads;
            public int Reads => Volatile.Read(ref reads);
            public int UntimedEmptyReads => Volatile.Read(ref untimedEmptyReads);
            public readonly ManualResetEventSlim Closing = new ManualResetEventSlim();
            public readonly ManualResetEventSlim FinishClose = new ManualResetEventSlim();
            public ReadBarrier(DatagramTransport inner) { this.inner = inner; }
            public int GetReceiveLimit() { return inner.GetReceiveLimit(); }
            public int GetSendLimit() { return inner.GetSendLimit(); }
            public int Receive(byte[] b, int o, int n, int wait) { return Receive(b.AsSpan(o, n), wait); }
            public int Receive(Span<byte> b, int wait)
            {
                if (Interlocked.Increment(ref reads) == 1)
                {
                    // A short datagram is discarded by BouncyCastle, so it
                    // advances to another transport read in this same call.
                    b[0] = 0;
                    return 1;
                }
                waitedOnOpenInput = false;
                int result = inner.Receive(b, wait);
                if (result < 0 && !waitedOnOpenInput) Interlocked.Increment(ref untimedEmptyReads);
                return result;
            }
            public void Send(byte[] b, int o, int n) { inner.Send(b, o, n); }
            public void Send(ReadOnlySpan<byte> b) { inner.Send(b); }
            public void Close()
            {
                Closing.Set();
                if (!FinishClose.Wait(10000)) throw new TimeoutException("fixture close barrier");
                inner.Close();
            }
        }

        public static int Main()
        {
            Paths.LogFile = Path.Combine(Environment.CurrentDirectory, "orderly.log");
            var before = new BeforeReceive();
            beforeReceive = before;
            using (var pair = new Pair())
            {
                if (!before.Entered.Wait(4000)) throw new InvalidOperationException("actual reader never reached barrier");
                object layer = Layer(pair.A);
                var barrier = new ReadBarrier((DatagramTransport)Get(layer, "m_transport"));
                Set(layer, "m_transport", barrier);
                Exception closeError = null;
                var closing = new Thread(() => { try { pair.A.Dispose(); } catch (Exception e) { closeError = e; } });
                try
                {

                    Check("actual established reader is parked before local close", Get(pair.A, "dtls") != null);
                    closing.Start();
                    if (!barrier.Closing.Wait(4000)) throw new InvalidOperationException("actual Dispose never reached DTLS close");
                    // Deliberately exceed the native read's 1000ms deadline
                    // before calling it. An inner-transport barrier would let
                    // the defective implementation pass after this delay.
                    var preparation = Stopwatch.StartNew();
                    Thread.Sleep(1100);
                    Check("setup delay cannot consume the library receive deadline", preparation.ElapsedMilliseconds >= 1000 && !before.Called);
                    before.Release.Set();
                    Check("the parked read returns within its original deadline", before.Stopped.Wait(3000));
                    Check("BouncyCastle can read multiple datagrams inside one receive", barrier.Reads > 1);
                    Check("retired established reader never polls empty reads", barrier.UntimedEmptyReads == 0);
                    Check("retired reader never starts another top-level receive", Volatile.Read(ref before.Calls) == 1);
                    Check("local orderly retirement never marks DTLS failed", !IsFailed(layer));
                    Check("local retirement sends no fatal alert to the live peer", !IsFailed(Layer(pair.B)));
                }
                finally
                {
                    before.Release.Set(); barrier.FinishClose.Set(); beforeReceive = null;
                    if (closing.ThreadState != System.Threading.ThreadState.Unstarted)
                        Check("actual local Dispose completes without a new failure", closing.Join(3000) && closeError == null);
                }
            }
            Thread.Sleep(100);
            Check("orderly pair shutdown records no swallowed exception", !File.Exists(Paths.LogFile) || new FileInfo(Paths.LogFile).Length == 0);

            // A genuine fatal alert on a still-live established peer must
            // remain visible. Never solve the race by filtering alert80.
            Paths.LogFile = Path.Combine(Environment.CurrentDirectory, "unexpected.log");
            using (var pair = new Pair())
            {
                object layer = Layer(pair.A);
                var reported = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                pair.B.Debug = message =>
                {
                    if (message.StartsWith("dtls: peer 1 stopped (", StringComparison.Ordinal))
                        reported.TrySetResult(true);
                };
                var remoteLayer = Layer(pair.B);
                // Force the transport to fail before its receive thread can
                // take the log gate. IsFailed is not a write-completion signal.
                LauncherLog.Holding(() =>
                {
                    layer.GetType().GetMethod("Fail", Hidden).Invoke(layer, new object[] { AlertDescription.internal_error });
                    Check("an unexpected remote fatal still fails the live transport", Wait(() => IsFailed(remoteLayer)));
                    Check("the failed transport has not reported while the writer gate is held", !reported.Task.IsCompleted);
                    return true;
                });
                // The stop diagnostic is sent after Failure.Why has returned
                // and disposed its append stream. Snapshot under the writer's
                // gate so even an unrelated append cannot overlap this read.
                bool finished = reported.Task.Wait(4000);
                string log = finished ? LauncherLog.Holding(() => File.Exists(Paths.LogFile) ?
                    File.ReadAllText(Paths.LogFile) : "") : "";
                Check("unexpected fatal alert80 is still logged with its stack",
                    log.Contains("TlsFatalAlertReceived: internal_error(80)") && log.Contains("at Thornswood.VoicePeer."));
            }

            // Before publication there is no established transport to close.
            // Preserve the original cancellation path; do not strand its reader
            // returning timeouts while the initial handshake retries.
            Paths.LogFile = Path.Combine(Environment.CurrentDirectory, "unestablished.log");
            using (var peer = new VoicePeer(3, true, new VoiceMix()))
            {
                peer.Dispose();
                Type adapter = typeof(VoicePeer).GetNestedType("Datagrams", BindingFlags.NonPublic);
                var io = (DatagramTransport)Activator.CreateInstance(adapter, Hidden, null, new object[] { peer }, null);
                bool canceled = false;
                try { io.Receive(new byte[1], 0, 1, 1); }
                catch (IOException) { canceled = true; }
                Check("initial unestablished cancellation still interrupts its transport", canceled);
            }
            Console.WriteLine(JsonSerializer.Serialize(new { checks, failed }));
            return failed == 0 ? 0 : 1;
        }
    }
}
