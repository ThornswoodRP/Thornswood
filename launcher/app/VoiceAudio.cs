using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// The microphone and the speakers, through WASAPI in shared mode: what
    /// getUserMedia and the AudioContext were in the voice page.
    ///
    /// Each side is one thread that Windows wakes when there is audio to
    /// take or room to fill (event driven), asking for 48 kHz 32 bit float,
    /// mono in and stereo out. AUTOCONVERTPCM has Windows convert from and to
    /// whatever the device runs at, so that is the format whatever the
    /// hardware is.
    ///
    /// The microphone is opened as a communications stream
    /// (AudioCategory_Communications). That is what asks Windows and the
    /// device's driver for the voice processing they offer, echo
    /// cancellation and noise suppression where there is any. The page had
    /// Chromium's own (echoCancellation, noiseSuppression and
    /// autoGainControl on getUserMedia). Without a browser there is no
    /// Chromium processing, so what is applied now is whatever this PC's
    /// Windows and microphone driver apply to a communications stream:
    /// Windows 11's Voice Clarity on the PCs that have it, a headset's own
    /// processing, or none.
    ///
    /// The same stream would have Windows lower every other sound while
    /// voice is open (the Communications tab's "reduce other sounds"), the
    /// game's included. The session opts out of that (SetDuckingPreference):
    /// the page's browser never ducked the game, and nobody asked for it.
    ///
    /// When a device goes away or the user changes the Windows default,
    /// the worker opens the device for that role. The active stream stays in use until the
    /// replacement has started.
    /// </summary>
    sealed partial class VoiceAudio : IDisposable
    {
        readonly VoiceMix mix;
        readonly Config cfg;
        readonly object lifecycle = new object();
        readonly ManualResetEvent stopping = new ManualResetEvent(false);
        volatile bool stop;
        Thread mic, speakers;

        /// <summary>One 20 ms frame from the microphone, mono, on the microphone's thread.</summary>
        public Action<float[]> OnFrame = delegate { };
        /// <summary>("status", "mic ready" or "no microphone") and ("log", a line), as the page reported them.</summary>
        public Action<string, string> OnEvent = delegate { };

        public VoiceAudio(VoiceMix mix, Config cfg)
        {
            this.mix = mix;
            this.cfg = cfg;
        }

        public void Start()
        {
            lock (lifecycle)
            {
                ObjectDisposedException.ThrowIf(stop, this);
                if (mic != null) return;
                mic = StartWorker(Capture, "Voice microphone");
                speakers = StartWorker(Playback, "Voice speakers");
            }
        }

        static Thread StartWorker(ThreadStart work, string name)
        {
            var worker = new Thread(work) { IsBackground = true, Name = name };
            worker.Start();
            return worker;
        }

        public void Dispose()
        {
            lock (lifecycle)
            {
                if (stop) return;
                stop = true;
                stopping.Set();
                mic?.Join();
                speakers?.Join();
                stopping.Dispose();
            }
        }

        // -------------------------------------------------------- the clock

        [LibraryImport("avrt.dll", StringMarshalling = StringMarshalling.Utf16)]
        private static partial nint AvSetMmThreadCharacteristicsW(string task, ref uint index);

        [LibraryImport("avrt.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool AvRevertMmThreadCharacteristics(nint handle);

        /// <summary>
        /// Windows' multimedia scheduler for this thread ("Pro Audio"), so a
        /// busy game does not starve the 20 ms it has to fill the speakers
        /// in. 0 when Windows would not.
        /// </summary>
        static nint Realtime()
        {
            uint index = 0;
            return AvSetMmThreadCharacteristicsW("Pro Audio", ref index);
        }

        void Capture() { RunAudio(VoiceCom.eCapture); }
        void Playback() { RunAudio(VoiceCom.eRender); }

        void RunAudio(int flow)
        {
            bool capture = flow == VoiceCom.eCapture;
            string label = capture ? "microphone" : "speakers";
            bool com = VoiceCom.Enter();
            nint mm = Realtime();
            try
            {
                for (int round = 0; round < 2 && !stop; round++)
                {
                    int result = RunEndpoint(flow, label);
                    if (result == VoiceCom.AUDCLNT_E_DEVICE_INVALIDATED && !stop)
                    {
                        OnEvent("log", "the " + label + " went away, opening the Windows device again");
                        continue;
                    }
                    if (result != 0 && !stop)
                        DeviceFailed(flow, "the " + label + " stopped (0x" + result.ToString("X8") + ")");
                    return;
                }
                if (!stop) DeviceFailed(flow, "the " + label + " went away again");
            }
            catch (Exception ex)
            {
                DeviceFailed(flow, Failure.Why("VoiceAudio, the " + label, ex, "the " + label));
            }
            finally
            {
                if (mm != 0) AvRevertMmThreadCharacteristics(mm);
                VoiceCom.Leave(com);
            }
        }

        int RunEndpoint(int flow, string label)
        {
            VoiceCom.IMMDeviceEnumerator enumerator = VoiceCom.Enumerator(out int result);
            if (enumerator == null)
            {
                DeviceFailed(flow, "no audio devices (0x" + result.ToString("X8") + ")");
                return 0;
            }

            try
            {
                using var watcher = WatchDefaults(enumerator, label);
                return VoiceEndpointWorker.Run(flow, stopping, watcher?.Changes,
                    () => ChooseEndpoint(enumerator, flow), error =>
                    {
                        if (error != 0)
                            OnEvent("log", "the replacement " + label + " could not start yet (0x" + error.ToString("X8") + ")");
                    });
            }
            finally { VoiceCom.Release(enumerator); }
        }

        VoiceDefaultDevices WatchDefaults(VoiceCom.IMMDeviceEnumerator enumerator, string label)
        {
            try { return new VoiceDefaultDevices(enumerator); }
            catch (COMException ex)
            {
                OnEvent("log", "Windows could not watch the default " + label + " (0x" + ex.ErrorCode.ToString("X8") + ")");
                return null;
            }
        }

        IVoiceEndpoint ChooseEndpoint(VoiceCom.IMMDeviceEnumerator enumerator, int flow)
        {
            VoiceCom.IMMDevice device = null;
            string name, note;
            int result = 0;
            try
            {
                if (flow == VoiceCom.eCapture)
                {
                    device = Mics.OpenForVoice(enumerator, cfg, out name, out note);
                }
                else
                {
                    result = AudioOutput.OpenForVoice(enumerator, cfg.AudioOutputId, out device);
                    name = device == null ? "" : VoiceCom.NameOf(device);
                    note = device == null ? "Windows has no speakers (0x" + result.ToString("X8") + ")" : "";
                }
                var selection = new NativeEndpoint(this, device, flow, name, note, result);
                device = null;
                return selection;
            }
            finally { VoiceCom.Release(device); }
        }

        void DeviceFailed(int flow, string reason)
        {
            bool capture = flow == VoiceCom.eCapture;
            OnEvent("log", (capture ? "microphone refused: " : "could not play voice: ") + reason);
            if (capture) OnEvent("status", "no microphone");
        }

        sealed class NativeEndpoint : IVoiceEndpoint
        {
            readonly VoiceAudio audio;
            readonly VoiceCom.IMMDevice device;
            readonly int flow, selectionResult;
            readonly string name, note;

            public NativeEndpoint(VoiceAudio audio, VoiceCom.IMMDevice device, int flow, string name, string note, int selectionResult)
            {
                this.audio = audio;
                this.device = device;
                this.flow = flow;
                this.name = name;
                this.note = note;
                this.selectionResult = selectionResult;
                Id = device == null ? "" : VoiceCom.IdOf(device);
            }

            public string Id { get; }

            public IVoiceEndpointStream Start(out int result)
            {
                result = selectionResult;
                if (device == null)
                {
                    if (result != VoiceCom.AUDCLNT_E_DEVICE_INVALIDATED)
                    {
                        audio.DeviceFailed(flow, note);
                        result = 0;
                    }
                    return null;
                }

                var stream = audio.OpenStream(device, flow, out result);
                if (stream == null) return null;
                try
                {
                    if (flow == VoiceCom.eCapture)
                    {
                        if (note.Length != 0) audio.OnEvent("log", note.Trim());
                        audio.OnEvent("log", "microphone open: " + (name.Length > 0 ? name : "unnamed"));
                        audio.OnEvent("status", "mic ready");
                    }
                    else audio.OnEvent("debug", "playing voice on " + name);
                    return stream;
                }
                catch
                {
                    stream.Dispose();
                    throw;
                }
            }

            public void Dispose() { VoiceCom.Release(device); }
        }

        sealed class NativeStream : IVoiceEndpointStream
        {
            readonly VoiceCom.IAudioClient2 client;
            readonly object service;
            readonly Func<int> process;
            readonly AutoResetEvent ready;

            public NativeStream(VoiceCom.IAudioClient2 client, object service, AutoResetEvent ready, Func<int> process)
            {
                this.client = client;
                this.service = service;
                this.ready = ready;
                this.process = process;
            }

            public WaitHandle Ready => ready;
            public int Process() { return process(); }

            public void Dispose()
            {
                try { client.Stop(); }
                finally
                {
                    VoiceCom.Release(service);
                    VoiceCom.Release(client);
                    ready.Dispose();
                }
            }
        }

        unsafe IVoiceEndpointStream OpenStream(VoiceCom.IMMDevice device, int flow, out int result)
        {
            bool capture = flow == VoiceCom.eCapture;
            var client = Activate(device, out result);
            if (client == null) return null;
            object service = null;
            var wake = new AutoResetEvent(false);
            NativeStream stream = null;
            try
            {
                if (capture)
                {
                    var props = new VoiceCom.AudioClientProperties
                    {
                        cbSize = (uint)sizeof(VoiceCom.AudioClientProperties),
                        eCategory = VoiceCom.AudioCategory_Communications
                    };
                    int processing = client.SetClientProperties(&props);
                    if (processing != 0) OnEvent("log", "the microphone is open without Windows' voice processing (0x" + processing.ToString("X8") + ")");
                }

                var format = VoiceCom.FloatFormat(VoiceMix.Rate, capture ? 1 : 2);
                result = client.Initialize(VoiceCom.AUDCLNT_SHAREMODE_SHARED,
                    VoiceCom.AUDCLNT_STREAMFLAGS_EVENTCALLBACK | VoiceCom.AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                    VoiceCom.AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY | VoiceCom.AUDCLNT_STREAMFLAGS_NOPERSIST,
                    capture ? 200000 : 400000, 0, &format, 0); // 20 ms capture, 40 ms render
                if (result != 0) return null;
                result = client.SetEventHandle(wake.SafeWaitHandle.DangerousGetHandle());
                if (result != 0) return null;

                Func<int> process;
                if (capture)
                {
                    NoDucking(client);
                    result = client.GetService(VoiceCom.IID_IAudioCaptureClient, out nint pointer);
                    if (result != 0) return null;
                    var packets = VoiceCom.Wrap<VoiceCom.IAudioCaptureClient>(pointer);
                    if (packets == null) { result = unchecked((int)0x80004003); return null; }
                    service = packets;
                    process = CapturePackets(packets);
                }
                else
                {
                    result = client.GetBufferSize(out uint size);
                    if (result != 0) return null;
                    result = client.GetService(VoiceCom.IID_IAudioRenderClient, out nint pointer);
                    if (result != 0) return null;
                    var render = VoiceCom.Wrap<VoiceCom.IAudioRenderClient>(pointer);
                    if (render == null) { result = unchecked((int)0x80004003); return null; }
                    service = render;
                    var samples = new float[size * 2];
                    process = () => RenderAudio(client, render, size, samples);
                }

                if (stop) return null;
                var candidate = new NativeStream(client, service, wake, process);
                result = client.Start();
                if (result != 0) return null;
                stream = candidate;
                return stream;
            }
            finally
            {
                if (stream == null)
                {
                    VoiceCom.Release(service);
                    VoiceCom.Release(client);
                    wake.Dispose();
                }
            }
        }

        unsafe Func<int> CapturePackets(VoiceCom.IAudioCaptureClient packets)
        {
            var frame = new float[VoiceMix.Frame];
            int have = 0;
            return delegate
            {
                while (!stop)
                {
                    int result = packets.GetNextPacketSize(out uint next);
                    if (result != 0) return result;
                    if (next == 0) break;
                    result = packets.GetBuffer(out nint data, out uint frames, out uint flags, out _, out _);
                    if (result < 0) return result;
                    if (result == VoiceCom.AUDCLNT_S_BUFFER_EMPTY || frames == 0) break;
                    try
                    {
                        var src = (float*)data;
                        bool silent = (flags & VoiceCom.AUDCLNT_BUFFERFLAGS_SILENT) != 0;
                        for (uint i = 0; i < frames && !stop; i++)
                        {
                            frame[have++] = silent ? 0f : src[i];
                            if (have == frame.Length)
                            {
                                OnFrame(frame);
                                frame = new float[VoiceMix.Frame];
                                have = 0;
                            }
                        }
                    }
                    finally { result = packets.ReleaseBuffer(frames); }
                    if (result != 0) return result;
                }
                return 0;
            };
        }

        unsafe int RenderAudio(VoiceCom.IAudioClient2 client, VoiceCom.IAudioRenderClient render, uint size, float[] samples)
        {
            int result = client.GetCurrentPadding(out uint padding);
            if (result != 0) return result;
            if (padding >= size) return 0;
            uint room = size - padding;
            result = render.GetBuffer(room, out nint data);
            if (result != 0) return result;
            uint flags = VoiceCom.AUDCLNT_BUFFERFLAGS_SILENT;
            try
            {
                mix.Render(samples, (int)room);
                new Span<float>(samples, 0, (int)room * 2).CopyTo(new Span<float>((void*)data, (int)room * 2));
                flags = 0;
            }
            finally { result = render.ReleaseBuffer(room, flags); }
            return result;
        }

        static VoiceCom.IAudioClient2 Activate(VoiceCom.IMMDevice dev, out int hr)
        {
            nint p;
            hr = dev.Activate(VoiceCom.IID_IAudioClient2, VoiceCom.CLSCTX_ALL, 0, out p);
            return hr == 0 ? VoiceCom.Wrap<VoiceCom.IAudioClient2>(p) : null;
        }

        void NoDucking(VoiceCom.IAudioClient2 client)
        {
            int hr = client.GetService(VoiceCom.IID_IAudioSessionControl2, out nint p);
            if (hr != 0) { OnEvent("log", "could not ask Windows not to lower other sounds (0x" + hr.ToString("X8") + ")"); return; }
            VoiceCom.IAudioSessionControl2 session = VoiceCom.Wrap<VoiceCom.IAudioSessionControl2>(p);
            if (session == null) return;
            try
            {
                hr = session.SetDuckingPreference(1);
                if (hr != 0) OnEvent("log", "could not ask Windows not to lower other sounds (0x" + hr.ToString("X8") + ")");
            }
            finally { VoiceCom.Release(session); }
        }
    }
}
