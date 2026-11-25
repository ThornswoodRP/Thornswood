using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;
using System.Threading;

namespace Thornswood
{
    // Notifications invalidate a worker's selection snapshot; the worker,
    // never the callback, resolves its configured microphone/default speaker.
    // Sample Version before selecting/opening a device to cover changes there.
    sealed class DefaultEndpointChanges
    {
        long capture, render;
        int stopped;

        public long Version(int flow)
        {
            return flow == VoiceCom.eRender ? Interlocked.Read(ref render) : Interlocked.Read(ref capture);
        }

        public void DefaultChanged(int flow, int role)
        {
            if (Volatile.Read(ref stopped) != 0) return;
            if (flow == VoiceCom.eRender && role == VoiceCom.eConsole) Interlocked.Increment(ref render);
            else if (flow == VoiceCom.eCapture && (role == VoiceCom.eConsole || role == VoiceCom.eCommunications))
                Interlocked.Increment(ref capture);
        }

        // A true result is only a proposal. After opening the replacement,
        // the worker acknowledges it by setting observed to generation. A
        // failed open leaves the original event pending without another
        // Windows notification. A same-device result needs no replacement.
        public bool ShouldReopen(int flow, ref long observed, string openedId, Func<string> desiredId, out long generation)
        {
            generation = observed;
            if (Volatile.Read(ref stopped) != 0) return false;
            long next = Version(flow);
            if (next == observed) return false;
            string desired = desiredId();
            // Keep a usable old stream while Windows has no replacement. Do
            // not consume this event: retry selection on a later worker turn.
            if (desired == null) return false;
            generation = next;
            if (!string.Equals(openedId, desired, StringComparison.Ordinal)) return true;
            observed = next;
            return false;
        }

        public void Stop() { Interlocked.Exchange(ref stopped, 1); }
    }

    // NativeAOT needs the generated CCW, not runtime ComVisible marshalling.
    // Exact vtable/nullable ID contract:
    // https://learn.microsoft.com/windows/win32/api/mmdeviceapi/nn-mmdeviceapi-immnotificationclient
    [GeneratedComInterface(StringMarshalling = StringMarshalling.Utf16)]
    [Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0")]
    internal partial interface IVoiceEndpointNotifications
    {
        [PreserveSig] int OnDeviceStateChanged(string deviceId, uint state);
        [PreserveSig] int OnDeviceAdded(string deviceId);
        [PreserveSig] int OnDeviceRemoved(string deviceId);
        [PreserveSig] int OnDefaultDeviceChanged(int flow, int role, string deviceId);
        [PreserveSig] int OnPropertyValueChanged(string deviceId, VoiceCom.PROPERTYKEY key);
    }

    [GeneratedComClass]
    internal sealed partial class VoiceEndpointNotifications : IVoiceEndpointNotifications
    {
        readonly DefaultEndpointChanges changes;
        public VoiceEndpointNotifications(DefaultEndpointChanges changes) { this.changes = changes; }
        public int OnDefaultDeviceChanged(int flow, int role, string deviceId)
        {
            // Microsoft requires nonblocking callbacks: no locks, waits, COM
            // calls, unregister/release, or worker/user callbacks here.
            changes.DefaultChanged(flow, role);
            return 0;
        }
        public int OnDeviceStateChanged(string deviceId, uint state) { return 0; }
        public int OnDeviceAdded(string deviceId) { return 0; }
        public int OnDeviceRemoved(string deviceId) { return 0; }
        public int OnPropertyValueChanged(string deviceId, VoiceCom.PROPERTYKEY key) { return 0; }
    }

    // Create and dispose on the audio worker, while its MMDevice enumerator
    // and COM apartment are alive. Register/Unregister do not AddRef/Release
    // this pointer; our marshaller reference must span the registration.
    sealed unsafe class VoiceDefaultDevices : IDisposable
    {
        public readonly DefaultEndpointChanges Changes = new DefaultEndpointChanges();
        readonly VoiceEndpointNotifications callback;
        readonly Func<nint, int> unregister;
        nint pointer;

        public VoiceDefaultDevices(VoiceCom.IMMDeviceEnumerator enumerator)
            : this(enumerator.RegisterEndpointNotificationCallback, enumerator.UnregisterEndpointNotificationCallback) { }

        internal VoiceDefaultDevices(Func<nint, int> register, Func<nint, int> unregister)
        {
            ArgumentNullException.ThrowIfNull(register);
            ArgumentNullException.ThrowIfNull(unregister);
            this.unregister = unregister;
            callback = new VoiceEndpointNotifications(Changes);
            pointer = (nint)ComInterfaceMarshaller<IVoiceEndpointNotifications>.ConvertToUnmanaged(callback);
            int hr;
            try { hr = register(pointer); }
            catch { Free(); throw; }
            if (hr < 0) { Free(); Marshal.ThrowExceptionForHR(hr); }
        }

        public void Dispose()
        {
            if (pointer == 0) return;
            Changes.Stop();
            int hr = unregister(pointer);
            // On failure retain the CCW reference rather than release a
            // pointer Windows may still call. The failure reaches the worker.
            Marshal.ThrowExceptionForHR(hr);
            Free();
            GC.KeepAlive(callback);
        }

        void Free()
        {
            nint p = pointer;
            pointer = 0;
            if (p != 0) ComInterfaceMarshaller<IVoiceEndpointNotifications>.Free((void*)p);
        }
    }

    interface IVoiceEndpoint : IDisposable
    {
        string Id { get; }
        IVoiceEndpointStream Start(out int result);
    }

    interface IVoiceEndpointStream : IDisposable
    {
        WaitHandle Ready { get; }
        int Process();
    }

    // Runs on a single capture or playback thread. Open a replacement while
    // the old stream is still valid and switch only after Windows starts it.
    static class VoiceEndpointWorker
    {
        // Some invalidated streams stop signaling before returning the error.
        const int ProbeMilliseconds = 200;
        const int RetryMilliseconds = 500;

        public static int Run(int flow, WaitHandle stopping, DefaultEndpointChanges changes,
            Func<IVoiceEndpoint> select, Action<int> replacementFailed)
        {
            long seen = changes?.Version(flow) ?? 0, attempted = seen, retryAt = 0;
            IVoiceEndpointStream active = null;
            try
            {
                string activeId;
                using (var initial = select())
                {
                    if (initial == null || stopping.WaitOne(0)) return 0;
                    activeId = initial.Id;
                    active = initial.Start(out int result);
                    if (active == null) return result;
                }
                WaitHandle[] signals = { stopping, active.Ready };
                while (WaitHandle.WaitAny(signals, ProbeMilliseconds) != 0 && !stopping.WaitOne(0))
                {
                    long newest = changes?.Version(flow) ?? seen;
                    long now = Environment.TickCount64;
                    if (newest != seen && (newest != attempted || now >= retryAt))
                    {
                        IVoiceEndpoint replacement = null;
                        bool newAttempt = newest != attempted;
                        attempted = newest;
                        retryAt = now + RetryMilliseconds;
                        try
                        {
                            if (changes.ShouldReopen(flow, ref seen, activeId, delegate
                            {
                                replacement = select();
                                return string.IsNullOrEmpty(replacement?.Id) ? null : replacement.Id;
                            }, out long openedVersion) && !stopping.WaitOne(0))
                            {
                                var next = replacement.Start(out int error);
                                if (next != null)
                                {
                                    var previous = active;
                                    active = next;
                                    activeId = replacement.Id;
                                    signals[1] = next.Ready;
                                    seen = openedVersion;
                                    previous.Dispose();
                                }
                                else if (newAttempt && !stopping.WaitOne(0)) replacementFailed(error);
                            }
                        }
                        finally { replacement?.Dispose(); }
                    }
                    if (stopping.WaitOne(0)) break;
                    int status = active.Process();
                    if (status != 0) return status;
                }
                return 0;
            }
            finally { active?.Dispose(); }
        }
    }
}
