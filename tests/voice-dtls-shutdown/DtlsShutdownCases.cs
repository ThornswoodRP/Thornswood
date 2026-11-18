using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using Org.BouncyCastle.Tls;

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
        static object Layer(VoicePeer p) { return Get(Get(p, "dtls"), "m_recordLayer"); }
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

        // Installed only after a real handshake. Park the actual reader and
        // transport close while real Dispose retires media. This exposes the
        // interval before the DTLS close has completed, without forcing flags.
        sealed class ReadBarrier : DatagramTransport
        {
            readonly DatagramTransport inner;
            int armed = 1;
            int reads;
            public int Reads { get { return Volatile.Read(ref reads); } }
            public readonly ManualResetEventSlim Entered = new ManualResetEventSlim();
            public readonly ManualResetEventSlim Release = new ManualResetEventSlim();
            public readonly ManualResetEventSlim Returned = new ManualResetEventSlim();
            public readonly ManualResetEventSlim Closing = new ManualResetEventSlim();
            public readonly ManualResetEventSlim FinishClose = new ManualResetEventSlim();
            public ReadBarrier(DatagramTransport inner) { this.inner = inner; }
            public int GetReceiveLimit() { return inner.GetReceiveLimit(); }
            public int GetSendLimit() { return inner.GetSendLimit(); }
            public int Receive(byte[] b, int o, int n, int wait) { return Receive(b.AsSpan(o, n), wait); }
            public int Receive(Span<byte> b, int wait)
            {
                Interlocked.Increment(ref reads);
                bool held = Interlocked.Exchange(ref armed, 0) != 0;
                if (held) { Entered.Set(); if (!Release.Wait(5000)) throw new TimeoutException("fixture read barrier"); }
                try { return inner.Receive(b, wait); }
                finally { if (held) Returned.Set(); }
            }
            public void Send(byte[] b, int o, int n) { inner.Send(b, o, n); }
            public void Send(ReadOnlySpan<byte> b) { inner.Send(b); }
            public void Close()
            {
                Closing.Set();
                if (!FinishClose.Wait(5000)) throw new TimeoutException("fixture close barrier");
                inner.Close();
            }
        }

        public static int Main()
        {
            Paths.LogFile = Path.Combine(Environment.CurrentDirectory, "orderly.log");
            using (var pair = new Pair())
            {
                object layer = Layer(pair.A);
                var barrier = new ReadBarrier((DatagramTransport)Get(layer, "m_transport"));
                Set(layer, "m_transport", barrier);
                Exception closeError = null;
                var closing = new Thread(() => { try { pair.A.Dispose(); } catch (Exception e) { closeError = e; } });
                try
                {
                    if (!barrier.Entered.Wait(4000)) throw new InvalidOperationException("actual reader never reached barrier");
                    Check("actual established reader is parked before local close", Get(pair.A, "dtls") != null);
                    closing.Start();
                    if (!barrier.Closing.Wait(4000)) throw new InvalidOperationException("actual Dispose never reached DTLS close");
                    barrier.Release.Set();
                    Check("the parked read returns within its original deadline", barrier.Returned.Wait(3000));
                    // Fail() runs after the transport returns. Observe it over
                    // longer than one receive period without changing timers.
                    Wait(() => IsFailed(layer), 1200);
                    Check("retired established reader never polls empty reads", barrier.Reads == 1);
                    Check("local orderly retirement never marks DTLS failed", !IsFailed(layer));
                    Check("local retirement sends no fatal alert to the live peer", !IsFailed(Layer(pair.B)));
                }
                finally
                {
                    barrier.Release.Set(); barrier.FinishClose.Set();
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
                layer.GetType().GetMethod("Fail", Hidden).Invoke(layer, new object[] { AlertDescription.internal_error });
                Check("an unexpected remote fatal still fails the live transport", Wait(() => IsFailed(Layer(pair.B))));
                Check("unexpected fatal alert80 is still logged with its stack", Wait(() => File.Exists(Paths.LogFile) &&
                    File.ReadAllText(Paths.LogFile).Contains("TlsFatalAlertReceived: internal_error(80)")));
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
