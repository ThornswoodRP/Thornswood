using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// Menu theme for the launcher, played by the launcher's own process.
    ///
    /// Windows' Volume Mixer lists sound by the process that plays it. Until
    /// #3207 the theme played as HTML5 audio in a hidden WebView2, and WebView2
    /// renders its sound in its own msedgewebview2.exe processes, so the mixer
    /// showed "Microsoft Edge WebView2" with Edge's icon, or nothing that said
    /// Thornswood, and turning the theme down there meant turning down every
    /// WebView2 program on the machine. WebView2 has no setting for this:
    /// github.com/MicrosoftEdge/WebView2Feedback/issues/2236, open since
    /// March 2022.
    ///
    /// So the theme is decoded here, by NLayer (a managed MP3 decoder, MIT,
    /// the NLayer package compiled into the exe, THIRD-PARTY.md), and handed to
    /// waveOut, which every Windows has. The sound then belongs to
    /// Thornswood.exe: the mixer shows the launcher's own entry, and this
    /// build names it ("Thornswood" or "Thornswood Dev", with the build's own
    /// icon) on its own audio session. The WPF MediaPlayer that came before
    /// WebView2 needed the Windows Media component the ship PC does not have
    /// ("Windows Media Player version 10 or later is required"), and Media
    /// Foundation is missing on N editions without the Media Feature Pack;
    /// neither is used.
    ///
    /// The Settings slider scales the samples, so it and the mixer's slider
    /// are two separate controls, the way they are for any program.
    /// </summary>
    static partial class MenuMusic
    {
        static Playback playback;
        static bool wantPlay;
        static double wantVol = 0.5;
        static string trackPath;
        static string mixerName = "Thornswood";
        static string mixerIcon;
        static Action<string> log;

        /// <summary>
        /// How many times the playback has been made this session, and closed.
        /// For tests\test-963-perf-settings.ps1 and the log line.
        /// </summary>
        public static int Opened, Closed;

        /// <summary>
        /// Remembers the track, the volume and what the mixer calls this
        /// build. The playback itself is made the first time Decide asks for the
        /// music, not here: a launcher that starts while the game runs, or
        /// with the music off in Settings, never makes one at all.
        /// </summary>
        public static void Start(string file, double volume, string name, string icon, Action<string> say)
        {
            log = say;
            trackPath = file;
            wantVol = Clamp(volume);
            if (!string.IsNullOrEmpty(name)) mixerName = name;
            mixerIcon = icon;
        }

        /// <summary>
        /// Stops the theme and closes its sound output. Called when the game
        /// starts: Patrick, 28 September (#963), nothing of the launcher's
        /// music stays open beside the game. Decide makes a new playback when
        /// the music is wanted again after the game closes. Safe to call any
        /// time, as often as wanted.
        /// </summary>
        public static void Close()
        {
            wantPlay = false;
            if (playback == null) return;
            var p = playback;
            playback = null;
            p.Stop();
            Closed++;
            Stamp("Menu music: closed its sound output while the game runs");
        }

        /// <summary>
        /// Plays or pauses the theme. A pause keeps the output open, so coming
        /// back from a minimised window is instant; only Close ends it. When
        /// the music is wanted and there is no playback (the first time, or
        /// after the game closed), one is made and starts at once.
        /// </summary>
        public static void Decide(bool play, double volume)
        {
            wantPlay = play;
            wantVol = Clamp(volume);
            if (play && playback == null) { Open(); return; }
            if (playback != null) playback.Set(wantPlay, wantVol);
        }

        static void Open()
        {
            if (string.IsNullOrEmpty(trackPath)) return;
            try
            {
                var p = new Playback(trackPath, mixerName, mixerIcon);
                p.Set(wantPlay, wantVol);
                playback = p;
                Opened++;
                p.Begin();
            }
            catch (Exception ex)
            {
                playback = null;
                Stamp("Menu music: did not start (" + ex.Message + ")");
            }
        }

        static double Clamp(double v)
        {
            if (v < 0) return 0;
            if (v > 1) return 1;
            return v;
        }

        static void Stamp(string m)
        {
            try { if (log != null) log(m); } catch (Exception ex) { Swallow.Note("MenuMusic.Stamp", ex); }
        }

        /// <summary>
        /// One open sound output and the thread that feeds it. The thread owns
        /// the decoder and every waveOut call; the shell only sets what it
        /// wants and wakes it. Stop does not wait for the thread: it lets go of
        /// the device on its own, so the window never waits on a sound driver.
        /// </summary>
        sealed class Playback
        {
            // Four buffers of a tenth of a second: a volume change is heard
            // within about 0.4 s, and a busy launcher has 0.3 s to spare
            // before the theme stutters.
            const int Buffers = 4;
            const int FramesPerBuffer = 4410;

            readonly string path, name, icon;
            readonly AutoResetEvent done = new AutoResetEvent(false);
            readonly AutoResetEvent wake = new AutoResetEvent(false);
            volatile bool play, stop;
            double vol;

            public Playback(string path, string name, string icon)
            {
                this.path = path;
                this.name = name;
                this.icon = icon;
            }

            public void Set(bool play, double volume)
            {
                Interlocked.Exchange(ref vol, volume);
                this.play = play;
                wake.Set();
            }

            public void Stop()
            {
                stop = true;
                wake.Set();
            }

            public void Begin()
            {
                var t = new Thread(Run);
                t.IsBackground = true;
                t.Name = "Menu music";
                t.SetApartmentState(ApartmentState.MTA);
                t.Start();
            }

            void Run()
            {
                NLayer.MpegFile file = null;
                IntPtr dev = IntPtr.Zero;
                var heads = new IntPtr[Buffers];
                var datas = new IntPtr[Buffers];
                bool paused = false;
                try
                {
                    file = new NLayer.MpegFile(path);
                    int channels = file.Channels;
                    int rate = file.SampleRate;
                    int bytes = FramesPerBuffer * channels * 2;

                    var fmt = new WaveFormat
                    {
                        Tag = 1,
                        Channels = (short)channels,
                        Rate = rate,
                        BytesPerSecond = rate * channels * 2,
                        BlockAlign = (short)(channels * 2),
                        Bits = 16,
                        Extra = 0
                    };
                    int r = waveOutOpen(out dev, WaveMapper, ref fmt, done.SafeWaitHandle.DangerousGetHandle(), IntPtr.Zero, CallbackEvent);
                    if (r != 0)
                    {
                        dev = IntPtr.Zero;
                        Stamp("Menu music: Windows would not open a sound output (waveOutOpen " + r + ")");
                        return;
                    }
                    MixerEntry.Name(name, icon, Stamp);

                    var floats = new float[FramesPerBuffer * channels];
                    var pcm = new short[FramesPerBuffer * channels];
                    for (int i = 0; i < Buffers; i++)
                    {
                        datas[i] = Marshal.AllocHGlobal(bytes);
                        heads[i] = Marshal.AllocHGlobal(HeaderSize);
                        var h = new WaveHeader { Data = datas[i], Length = bytes };
                        Marshal.StructureToPtr(h, heads[i], false);
                        r = waveOutPrepareHeader(dev, heads[i], HeaderSize);
                        if (r != 0) { Stamp("Menu music: waveOutPrepareHeader " + r); return; }
                    }

                    if (!play) { waveOutPause(dev); paused = true; }
                    for (int i = 0; i < Buffers; i++)
                    {
                        if (!Fill(file, floats, pcm, heads[i], datas[i])) return;
                        r = waveOutWrite(dev, heads[i], HeaderSize);
                        if (r != 0) { Stamp("Menu music: waveOutWrite " + r); return; }
                    }
                    Stamp("Menu music: the theme is on, from " + path);

                    var waits = new WaitHandle[] { done, wake };
                    while (true)
                    {
                        WaitHandle.WaitAny(waits);
                        if (stop) return;
                        if (play == paused)
                        {
                            if (play) waveOutRestart(dev); else waveOutPause(dev);
                            paused = !play;
                        }
                        for (int i = 0; i < Buffers; i++)
                        {
                            if ((Marshal.ReadInt32(heads[i], FlagsAt) & HeaderDone) == 0) continue;
                            if (!Fill(file, floats, pcm, heads[i], datas[i])) return;
                            r = waveOutWrite(dev, heads[i], HeaderSize);
                            if (r != 0) { Stamp("Menu music: waveOutWrite " + r); return; }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Stamp("Menu music: stopped (" + ex.Message + ")");
                }
                finally
                {
                    if (dev != IntPtr.Zero)
                    {
                        // Reset hands every queued buffer back, so each can be
                        // unprepared and freed before the device closes.
                        waveOutReset(dev);
                        for (int i = 0; i < Buffers; i++)
                            if (heads[i] != IntPtr.Zero) waveOutUnprepareHeader(dev, heads[i], HeaderSize);
                        waveOutClose(dev);
                    }
                    for (int i = 0; i < Buffers; i++)
                    {
                        if (heads[i] != IntPtr.Zero) Marshal.FreeHGlobal(heads[i]);
                        if (datas[i] != IntPtr.Zero) Marshal.FreeHGlobal(datas[i]);
                    }
                    // The two events are left to the collector: the shell may
                    // still Set wake on a playback whose thread has ended.
                    if (file != null) { try { file.Dispose(); } catch (Exception ex) { Swallow.Note("MenuMusic.Playback, dispose", ex); } }
                }
            }

            /// <summary>
            /// Decodes the next tenth of a second into one buffer at the
            /// Settings volume, going back to the start at the end of the
            /// track, since the theme loops. False when the track gives no
            /// sound at all, which is said in the log.
            /// </summary>
            bool Fill(NLayer.MpegFile file, float[] floats, short[] pcm, IntPtr head, IntPtr data)
            {
                int got = 0;
                bool rewound = false;
                while (got < floats.Length)
                {
                    int n = file.ReadSamples(floats, got, floats.Length - got);
                    if (n > 0) { got += n; rewound = false; continue; }
                    if (rewound)
                    {
                        Stamp("Menu music: " + path + " has no sound in it to play");
                        return false;
                    }
                    file.Position = 0;
                    rewound = true;
                }
                double v = Interlocked.CompareExchange(ref vol, 0, 0);
                for (int i = 0; i < floats.Length; i++)
                {
                    double s = floats[i] * v;
                    if (s > 1) s = 1; else if (s < -1) s = -1;
                    pcm[i] = (short)(s * 32767);
                }
                Marshal.Copy(pcm, 0, data, pcm.Length);
                int flags = Marshal.ReadInt32(head, FlagsAt);
                Marshal.WriteInt32(head, FlagsAt, flags & ~HeaderDone);
                return true;
            }
        }

        /// <summary>
        /// The name and icon of this process's audio session, which is what
        /// the Volume Mixer shows for it. Set on the default output for
        /// programs and for media, the two a waveOut stream can be sent to,
        /// each time a playback opens. Only this process's own session is
        /// touched, never another program's.
        /// </summary>
        internal static partial class MixerEntry
        {
            // The COM objects are wrapped by ComWrappers with code the compiler
            // writes ([GeneratedComInterface]), which the native build needs:
            // the runtime's built-in COM interop is not there in it. Each
            // wrapper lets go of its object with FinalRelease as soon as it is
            // done with, as Marshal.ReleaseComObject did for the old ones.
            static readonly StrategyBasedComWrappers Wrappers = new StrategyBasedComWrappers();

            public static void Name(string name, string icon, Action<string> say)
            {
                IMMDeviceEnumerator devices = null;
                try
                {
                    Guid clsid = MMDeviceEnumeratorClsid, iid = typeof(IMMDeviceEnumerator).GUID;
                    IntPtr raw;
                    int made = CoCreateInstance(ref clsid, IntPtr.Zero, ClsCtxAll, ref iid, out raw);
                    if (made != 0) throw Marshal.GetExceptionForHR(made);
                    devices = (IMMDeviceEnumerator)Wrap(raw);
                    foreach (int role in new[] { RoleConsole, RoleMultimedia })
                    {
                        IMMDevice device;
                        if (devices.GetDefaultAudioEndpoint(DataFlowRender, role, out device) != 0 || device == null) continue;
                        try
                        {
                            Guid managerIid = typeof(IAudioSessionManager).GUID;
                            IntPtr o;
                            if (device.Activate(ref managerIid, ClsCtxAll, IntPtr.Zero, out o) != 0 || o == IntPtr.Zero) continue;
                            var manager = (IAudioSessionManager)Wrap(o);
                            try
                            {
                                IAudioSessionControl session;
                                Guid none = Guid.Empty;
                                if (manager.GetAudioSessionControl(ref none, 0, out session) == 0 && session != null)
                                {
                                    Guid context = Guid.Empty;
                                    int a = session.SetDisplayName(name, ref context);
                                    int b = string.IsNullOrEmpty(icon) ? 0 : session.SetIconPath(icon, ref context);
                                    if (a != 0 || b != 0)
                                        say("Menu music: the mixer entry kept its default name or icon (SetDisplayName " + a + ", SetIconPath " + b + ")");
                                    Release(session);
                                }
                            }
                            finally { Release(manager); }
                        }
                        finally { Release(device); }
                    }
                }
                catch (Exception ex)
                {
                    say("Menu music: could not name the mixer entry (" + ex.Message + ")");
                }
                finally
                {
                    Release(devices);
                }
            }

            /// <summary>
            /// The wrapper for a COM pointer handed back with a reference of
            /// ours on it. The wrapper takes a reference of its own, so ours is
            /// let go of here.
            /// </summary>
            static object Wrap(IntPtr unknown)
            {
                try { return Wrappers.GetOrCreateObjectForComInstance(unknown, CreateObjectFlags.UniqueInstance); }
                finally { Marshal.Release(unknown); }
            }

            static void Release(object o)
            {
                var com = o as ComObject;
                if (com != null) com.FinalRelease();
            }

            const int DataFlowRender = 0;
            const int RoleConsole = 0;
            const int RoleMultimedia = 1;
            const int ClsCtxAll = 0x17;
            static readonly Guid MMDeviceEnumeratorClsid = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");

            [LibraryImport("ole32.dll")]
            private static partial int CoCreateInstance(ref Guid clsid, IntPtr outer, int clsCtx, ref Guid iid, out IntPtr instance);

            // Each interface lists its methods in vtable order up to the last
            // one called here.
            [GeneratedComInterface, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
            internal partial interface IMMDeviceEnumerator
            {
                [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
                [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
            }

            [GeneratedComInterface, Guid("D666063F-1587-4E43-81F1-B948E807363F")]
            internal partial interface IMMDevice
            {
                [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IntPtr iface);
            }

            [GeneratedComInterface, Guid("BFA971F1-4D5E-40BB-935E-967039BFBEE4")]
            internal partial interface IAudioSessionManager
            {
                [PreserveSig] int GetAudioSessionControl(ref Guid sessionGuid, int streamFlags, out IAudioSessionControl session);
            }

            [GeneratedComInterface(StringMarshalling = StringMarshalling.Utf16), Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
            internal partial interface IAudioSessionControl
            {
                [PreserveSig] int GetState(out int state);
                [PreserveSig] int GetDisplayName(out IntPtr name);
                [PreserveSig] int SetDisplayName(string name, ref Guid eventContext);
                [PreserveSig] int GetIconPath(out IntPtr path);
                [PreserveSig] int SetIconPath(string path, ref Guid eventContext);
            }
        }

        // ------------------------------------------------------------ waveOut

        const int WaveMapper = -1;
        const int CallbackEvent = 0x00050000;
        const int HeaderDone = 0x00000001;
        static readonly int HeaderSize = Marshal.SizeOf<WaveHeader>();
        static readonly int FlagsAt = (int)Marshal.OffsetOf<WaveHeader>(nameof(WaveHeader.Flags));

        [StructLayout(LayoutKind.Sequential, Pack = 2)]
        struct WaveFormat
        {
            public short Tag;
            public short Channels;
            public int Rate;
            public int BytesPerSecond;
            public short BlockAlign;
            public short Bits;
            public short Extra;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct WaveHeader
        {
            public IntPtr Data;
            public int Length;
            public int Recorded;
            public IntPtr User;
            public int Flags;
            public int Loops;
            public IntPtr Next;
            public IntPtr Reserved;
        }

        [LibraryImport("winmm.dll")]
        private static partial int waveOutOpen(out IntPtr device, int deviceId, ref WaveFormat format, IntPtr callback, IntPtr instance, int flags);
        [LibraryImport("winmm.dll")]
        private static partial int waveOutPrepareHeader(IntPtr device, IntPtr header, int size);
        [LibraryImport("winmm.dll")]
        private static partial int waveOutUnprepareHeader(IntPtr device, IntPtr header, int size);
        [LibraryImport("winmm.dll")]
        private static partial int waveOutWrite(IntPtr device, IntPtr header, int size);
        [LibraryImport("winmm.dll")]
        private static partial int waveOutPause(IntPtr device);
        [LibraryImport("winmm.dll")]
        private static partial int waveOutRestart(IntPtr device);
        [LibraryImport("winmm.dll")]
        private static partial int waveOutReset(IntPtr device);
        [LibraryImport("winmm.dll")]
        private static partial int waveOutClose(IntPtr device);
    }
}
