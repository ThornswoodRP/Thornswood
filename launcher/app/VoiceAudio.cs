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
    /// When a device goes away (unplugged, disabled, or the default moved),
    /// Windows says so with AUDCLNT_E_DEVICE_INVALIDATED, and the side that
    /// lost it opens the one that now holds its place, once. With nothing to
    /// open, the microphone says "no microphone" and voice listens only, as
    /// the page did when getUserMedia was refused, until the next start.
    /// </summary>
    sealed partial class VoiceAudio : IDisposable
    {
        readonly VoiceMix mix;
        readonly Config cfg;
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
            mic = new Thread(Capture) { IsBackground = true, Name = "Voice microphone" };
            speakers = new Thread(Playback) { IsBackground = true, Name = "Voice speakers" };
            mic.Start();
            speakers.Start();
        }

        public void Dispose()
        {
            stop = true;
            if (mic != null) mic.Join(1000);
            if (speakers != null) speakers.Join(1000);
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

        // ------------------------------------------------------- microphone

        void Capture()
        {
            bool com = VoiceCom.Enter();
            nint mm = Realtime();
            try
            {
                for (int round = 0; round < 2 && !stop; round++)
                {
                    int hr = CaptureOnce(round > 0);
                    if (hr != VoiceCom.AUDCLNT_E_DEVICE_INVALIDATED) return;
                    OnEvent("log", "the microphone went away (unplugged or switched off), opening the one Windows has now");
                }
                OnEvent("log", "the microphone went away again, so voice listens only until the launcher starts again");
                OnEvent("status", "no microphone");
            }
            catch (Exception ex)
            {
                OnEvent("log", "microphone refused: " + ex.Message);
                OnEvent("status", "no microphone");
            }
            finally
            {
                if (mm != 0) AvRevertMmThreadCharacteristics(mm);
                VoiceCom.Leave(com);
            }
        }

        /// <summary>
        /// Opens the microphone and reads it until told to stop. Returns the
        /// HRESULT that ended it: 0 for a stop, AUDCLNT_E_DEVICE_INVALIDATED
        /// when the device went away.
        /// </summary>
        unsafe int CaptureOnce(bool again)
        {
            int hr;
            VoiceCom.IMMDeviceEnumerator en = VoiceCom.Enumerator(out hr);
            if (en == null) { Refused("no audio devices (0x" + hr.ToString("X8") + ")"); return 0; }
            VoiceCom.IMMDevice dev = null;
            VoiceCom.IAudioClient2 client = null;
            VoiceCom.IAudioCaptureClient cap = null;
            var wake = new AutoResetEvent(false);
            try
            {
                string name, why;
                dev = Mics.OpenForVoice(en, cfg, out name, out why);
                if (dev == null) { Refused(why); return 0; }
                if (why.Length > 0) OnEvent("log", why.Trim());

                client = Activate(dev, out hr);
                if (client == null) { Refused("Windows would not open " + name + " (0x" + hr.ToString("X8") + ")"); return 0; }

                var props = new VoiceCom.AudioClientProperties
                {
                    cbSize = (uint)sizeof(VoiceCom.AudioClientProperties),
                    eCategory = VoiceCom.AudioCategory_Communications
                };
                hr = client.SetClientProperties(&props);
                if (hr != 0) OnEvent("log", "the microphone is open without Windows' voice processing (0x" + hr.ToString("X8") + ")");

                var fmt = VoiceCom.FloatFormat(VoiceMix.Rate, 1);
                hr = client.Initialize(VoiceCom.AUDCLNT_SHAREMODE_SHARED,
                    VoiceCom.AUDCLNT_STREAMFLAGS_EVENTCALLBACK | VoiceCom.AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                    VoiceCom.AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY | VoiceCom.AUDCLNT_STREAMFLAGS_NOPERSIST,
                    200000, 0, &fmt, 0);   // 20 ms of buffer, in 100 ns units
                if (hr != 0) { Refused("Windows would not start " + name + " (0x" + hr.ToString("X8") + ")"); return 0; }

                NoDucking(client);

                nint p;
                hr = client.GetService(VoiceCom.IID_IAudioCaptureClient, out p);
                if (hr != 0) { Refused("no capture service on " + name + " (0x" + hr.ToString("X8") + ")"); return 0; }
                cap = VoiceCom.Wrap<VoiceCom.IAudioCaptureClient>(p);
                client.SetEventHandle(wake.SafeWaitHandle.DangerousGetHandle());
                hr = client.Start();
                if (hr != 0) { Refused(name + " would not start (0x" + hr.ToString("X8") + ")"); return 0; }

                // The page's words: the launcher logs both.
                OnEvent("log", "microphone open: " + (name.Length > 0 ? name : "unnamed"));
                OnEvent("status", "mic ready");

                float[] frame = new float[VoiceMix.Frame];
                int have = 0;
                while (!stop)
                {
                    wake.WaitOne(200);
                    while (true)
                    {
                        uint next;
                        hr = cap.GetNextPacketSize(out next);
                        if (hr != 0) return Stopped(client, hr);
                        if (next == 0) break;
                        nint data; uint frames, flags; ulong pos, qpc;
                        hr = cap.GetBuffer(out data, out frames, out flags, out pos, out qpc);
                        if (hr != 0) return Stopped(client, hr);
                        float* src = (float*)data;
                        bool silent = (flags & VoiceCom.AUDCLNT_BUFFERFLAGS_SILENT) != 0;
                        for (uint i = 0; i < frames; i++)
                        {
                            frame[have++] = silent ? 0f : src[i];
                            if (have == frame.Length)
                            {
                                OnFrame(frame);
                                frame = new float[VoiceMix.Frame];
                                have = 0;
                            }
                        }
                        cap.ReleaseBuffer(frames);
                    }
                }
                client.Stop();
                return 0;
            }
            finally
            {
                VoiceCom.Release(cap);
                VoiceCom.Release(client);
                VoiceCom.Release(dev);
                VoiceCom.Release(en);
                wake.Dispose();
            }
        }

        int Stopped(VoiceCom.IAudioClient2 client, int hr)
        {
            client.Stop();
            if (hr == VoiceCom.AUDCLNT_E_DEVICE_INVALIDATED) return hr;
            Refused("the microphone stopped (0x" + hr.ToString("X8") + ")");
            return 0;
        }

        void Refused(string why)
        {
            OnEvent("log", "microphone refused: " + why);
            OnEvent("status", "no microphone");
        }

        static VoiceCom.IAudioClient2 Activate(VoiceCom.IMMDevice dev, out int hr)
        {
            nint p;
            hr = dev.Activate(VoiceCom.IID_IAudioClient2, VoiceCom.CLSCTX_ALL, 0, out p);
            return hr == 0 ? VoiceCom.Wrap<VoiceCom.IAudioClient2>(p) : null;
        }

        void NoDucking(VoiceCom.IAudioClient2 client)
        {
            nint p;
            int hr = client.GetService(VoiceCom.IID_IAudioSessionControl2, out p);
            if (hr != 0) { OnEvent("log", "could not ask Windows not to lower other sounds (0x" + hr.ToString("X8") + ")"); return; }
            VoiceCom.IAudioSessionControl2 s = VoiceCom.Wrap<VoiceCom.IAudioSessionControl2>(p);
            try
            {
                hr = s.SetDuckingPreference(1);
                if (hr != 0) OnEvent("log", "could not ask Windows not to lower other sounds (0x" + hr.ToString("X8") + ")");
            }
            finally { VoiceCom.Release(s); }
        }

        // --------------------------------------------------------- speakers

        void Playback()
        {
            bool com = VoiceCom.Enter();
            nint mm = Realtime();
            try
            {
                for (int round = 0; round < 2 && !stop; round++)
                {
                    int hr = PlaybackOnce();
                    if (hr != VoiceCom.AUDCLNT_E_DEVICE_INVALIDATED) return;
                    OnEvent("log", "the speakers went away (unplugged or the default changed), playing on the ones Windows has now");
                }
                OnEvent("log", "the speakers went away again, so nobody is heard until the launcher starts again");
            }
            catch (Exception ex) { OnEvent("log", "could not play voice: " + ex.Message); }
            finally
            {
                if (mm != 0) AvRevertMmThreadCharacteristics(mm);
                VoiceCom.Leave(com);
            }
        }

        /// <summary>
        /// Plays the mix on Windows' default output until told to stop, the
        /// device the page's AudioContext played on. Returns as CaptureOnce.
        /// </summary>
        unsafe int PlaybackOnce()
        {
            int hr;
            VoiceCom.IMMDeviceEnumerator en = VoiceCom.Enumerator(out hr);
            if (en == null) { OnEvent("log", "could not play voice: no audio devices (0x" + hr.ToString("X8") + ")"); return 0; }
            VoiceCom.IMMDevice dev = null;
            VoiceCom.IAudioClient2 client = null;
            VoiceCom.IAudioRenderClient ren = null;
            var wake = new AutoResetEvent(false);
            try
            {
                hr = en.GetDefaultAudioEndpoint(VoiceCom.eRender, VoiceCom.eConsole, out dev);
                if (hr != 0 || dev == null) { OnEvent("log", "could not play voice: Windows has no speakers (0x" + hr.ToString("X8") + ")"); return 0; }
                string name = VoiceCom.NameOf(dev);
                client = Activate(dev, out hr);
                if (client == null) { OnEvent("log", "could not play voice on " + name + " (0x" + hr.ToString("X8") + ")"); return 0; }

                var fmt = VoiceCom.FloatFormat(VoiceMix.Rate, 2);
                hr = client.Initialize(VoiceCom.AUDCLNT_SHAREMODE_SHARED,
                    VoiceCom.AUDCLNT_STREAMFLAGS_EVENTCALLBACK | VoiceCom.AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                    VoiceCom.AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY | VoiceCom.AUDCLNT_STREAMFLAGS_NOPERSIST,
                    400000, 0, &fmt, 0);   // 40 ms
                if (hr != 0) { OnEvent("log", "could not play voice on " + name + " (0x" + hr.ToString("X8") + ")"); return 0; }

                uint size;
                client.GetBufferSize(out size);
                nint p;
                hr = client.GetService(VoiceCom.IID_IAudioRenderClient, out p);
                if (hr != 0) { OnEvent("log", "could not play voice on " + name + " (0x" + hr.ToString("X8") + ")"); return 0; }
                ren = VoiceCom.Wrap<VoiceCom.IAudioRenderClient>(p);
                client.SetEventHandle(wake.SafeWaitHandle.DangerousGetHandle());

                float[] buf = new float[size * 2];
                hr = client.Start();
                if (hr != 0) { OnEvent("log", "could not play voice on " + name + " (0x" + hr.ToString("X8") + ")"); return 0; }
                OnEvent("debug", "playing voice on " + name);

                while (!stop)
                {
                    wake.WaitOne(200);
                    uint padding;
                    hr = client.GetCurrentPadding(out padding);
                    if (hr != 0) { client.Stop(); return hr == VoiceCom.AUDCLNT_E_DEVICE_INVALIDATED ? hr : Quit(hr); }
                    uint room = size - padding;
                    if (room == 0) continue;
                    nint data;
                    hr = ren.GetBuffer(room, out data);
                    if (hr != 0) { client.Stop(); return hr == VoiceCom.AUDCLNT_E_DEVICE_INVALIDATED ? hr : Quit(hr); }
                    mix.Render(buf, (int)room);
                    new Span<float>(buf, 0, (int)room * 2).CopyTo(new Span<float>((void*)data, (int)room * 2));
                    ren.ReleaseBuffer(room, 0);
                }
                client.Stop();
                return 0;
            }
            finally
            {
                VoiceCom.Release(ren);
                VoiceCom.Release(client);
                VoiceCom.Release(dev);
                VoiceCom.Release(en);
                wake.Dispose();
            }
        }

        int Quit(int hr)
        {
            OnEvent("log", "voice playback stopped (0x" + hr.ToString("X8") + ")");
            return 0;
        }
    }
}
