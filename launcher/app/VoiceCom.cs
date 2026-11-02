using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;

namespace Thornswood
{
    /// <summary>
    /// The Windows audio interfaces voice and the microphone chooser use: the
    /// MMDevice API (which devices there are, which is the default, what each
    /// is called) and WASAPI (capture and playback in shared mode).
    ///
    /// Source-generated COM (#4823): [GeneratedComInterface] and
    /// StrategyBasedComWrappers instead of [ComImport], because the launcher
    /// is compiled to native code and the runtime's built-in COM marshalling
    /// does not exist there. Every method keeps its HRESULT ([PreserveSig]),
    /// so a failure is a number the caller reads and names in the log rather
    /// than an exception thrown from inside a vtable call.
    ///
    /// Only the methods called are spelled out with their real arguments,
    /// but every slot before the last one called is declared, in order: a
    /// COM interface is a table of function pointers, and a missing slot
    /// moves every method after it onto somebody else's function.
    ///
    /// Nothing here is Media Foundation. The MMDevice API and WASAPI are
    /// Windows' core audio, present on every edition, the N editions without
    /// the Media Feature Pack included.
    /// </summary>
    static unsafe partial class VoiceCom
    {
        public const int eRender = 0;
        public const int eCapture = 1;
        public const int eConsole = 0;
        public const int eCommunications = 2;
        public const int DEVICE_STATE_ACTIVE = 0x1;

        public const int CLSCTX_ALL = 0x17;
        public const int AUDCLNT_SHAREMODE_SHARED = 0;
        public const uint AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
        public const uint AUDCLNT_STREAMFLAGS_NOPERSIST = 0x00080000;
        public const uint AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY = 0x08000000;
        public const uint AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = 0x80000000;
        public const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
        public const int AUDCLNT_E_DEVICE_INVALIDATED = unchecked((int)0x88890004);
        public const int AudioCategory_Communications = 3;

        public static readonly Guid CLSID_MMDeviceEnumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
        public static readonly Guid IID_IMMDeviceEnumerator = new Guid("A95664D2-9614-4F35-A746-DE8DB63617E6");
        public static readonly Guid IID_IAudioClient2 = new Guid("726778CD-F60A-4EDA-82DE-E47610CD78AA");
        public static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317");
        public static readonly Guid IID_IAudioRenderClient = new Guid("F294ACFC-3146-4483-A7BF-ADDCA7C260E2");
        public static readonly Guid IID_IAudioSessionControl2 = new Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D");

        // KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: 32 bit float samples.
        static readonly Guid SubtypeFloat = new Guid("00000003-0000-0010-8000-00AA00389B71");

        // ------------------------------------------------------------ calls

        const int COINIT_MULTITHREADED = 0x0;

        [LibraryImport("ole32.dll")]
        private static partial int CoInitializeEx(nint reserved, int coinit);

        [LibraryImport("ole32.dll")]
        private static partial void CoUninitialize();

        [LibraryImport("ole32.dll")]
        private static partial int CoCreateInstance(in Guid clsid, nint outer, int clsctx, in Guid iid, out nint ppv);

        [LibraryImport("ole32.dll")]
        public static partial int PropVariantClear(ref PROPVARIANT pvar);

        [LibraryImport("ole32.dll")]
        public static partial void CoTaskMemFree(nint p);

        /// <summary>
        /// COM on this thread for as long as the caller holds the result.
        /// A thread that already has COM keeps what it has: the window's
        /// thread is single threaded and answers RPC_E_CHANGED_MODE, which
        /// is fine, because the device enumerator works in either kind.
        /// </summary>
        public static bool Enter()
        {
            int hr = CoInitializeEx(0, COINIT_MULTITHREADED);
            return hr == 0 || hr == 1;   // S_OK or S_FALSE: ours to undo
        }

        public static void Leave(bool entered)
        {
            if (entered) CoUninitialize();
        }

        static readonly StrategyBasedComWrappers Wrappers = new StrategyBasedComWrappers();

        /// <summary>A COM pointer as the interface named, taking over its reference.</summary>
        public static T Wrap<T>(nint p) where T : class
        {
            if (p == 0) return null;
            try { return (T)Wrappers.GetOrCreateObjectForComInstance(p, CreateObjectFlags.UniqueInstance); }
            finally { Marshal.Release(p); }
        }

        /// <summary>The device enumerator, or null with the HRESULT in hr.</summary>
        public static IMMDeviceEnumerator Enumerator(out int hr)
        {
            nint p;
            hr = CoCreateInstance(CLSID_MMDeviceEnumerator, 0, CLSCTX_ALL, IID_IMMDeviceEnumerator, out p);
            if (hr != 0) return null;
            return Wrap<IMMDeviceEnumerator>(p);
        }

        /// <summary>Lets go of a wrapped COM object now rather than when the collector gets to it.</summary>
        public static void Release(object o)
        {
            if (o is ComObject c) c.FinalRelease();
        }

        /// <summary>
        /// A device's friendly name, the one that reads "Microphone (FIFINE
        /// K669B)" rather than the driver's idea of the hardware. "" when it
        /// cannot be read.
        /// </summary>
        public static string NameOf(IMMDevice dev)
        {
            IPropertyStore store = null;
            try
            {
                // STGM_READ
                if (dev.OpenPropertyStore(0, out store) != 0 || store == null) return "";
                // PKEY_Device_FriendlyName
                var key = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
                PROPVARIANT v;
                if (store.GetValue(ref key, out v) != 0) return "";
                try
                {
                    // VT_LPWSTR
                    if (v.vt != 31 || v.pointerValue == 0) return "";
                    return Marshal.PtrToStringUni(v.pointerValue) ?? "";
                }
                finally { PropVariantClear(ref v); }
            }
            finally { Release(store); }
        }

        /// <summary>The endpoint id string Windows keeps for a device, or "".</summary>
        public static string IdOf(IMMDevice dev)
        {
            nint p;
            if (dev.GetId(out p) != 0 || p == 0) return "";
            try { return Marshal.PtrToStringUni(p) ?? ""; }
            finally { CoTaskMemFree(p); }
        }

        /// <summary>
        /// The 32 bit float format voice asks Windows for: 48 kHz, mono for
        /// the microphone and stereo for playback. Shared mode with
        /// AUTOCONVERTPCM converts to and from whatever the device itself
        /// runs at, so this is the format whatever the hardware is.
        /// </summary>
        public static WAVEFORMATEXTENSIBLE FloatFormat(int rate, int channels)
        {
            var f = new WAVEFORMATEXTENSIBLE();
            f.wFormatTag = 0xFFFE;   // WAVE_FORMAT_EXTENSIBLE
            f.nChannels = (ushort)channels;
            f.nSamplesPerSec = (uint)rate;
            f.wBitsPerSample = 32;
            f.nBlockAlign = (ushort)(channels * 4);
            f.nAvgBytesPerSec = (uint)(rate * channels * 4);
            f.cbSize = 22;
            f.wValidBitsPerSample = 32;
            f.dwChannelMask = channels == 1 ? 0x4u : 0x3u;   // front centre; front left and right
            f.SubFormat = SubtypeFloat;
            return f;
        }

        // ------------------------------------------------------------ types

        [StructLayout(LayoutKind.Sequential)]
        public struct PROPERTYKEY
        {
            public Guid fmtid;
            public int pid;
        }

        // Only the shape matters, and only the first union member is read. The
        // real thing is bigger than this on paper, which is why the explicit
        // size is here rather than left to the marshaller.
        [StructLayout(LayoutKind.Explicit, Size = 16)]
        public struct PROPVARIANT
        {
            [FieldOffset(0)] public short vt;
            [FieldOffset(8)] public nint pointerValue;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        public struct WAVEFORMATEXTENSIBLE
        {
            public ushort wFormatTag;
            public ushort nChannels;
            public uint nSamplesPerSec;
            public uint nAvgBytesPerSec;
            public ushort nBlockAlign;
            public ushort wBitsPerSample;
            public ushort cbSize;
            public ushort wValidBitsPerSample;
            public uint dwChannelMask;
            public Guid SubFormat;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct AudioClientProperties
        {
            public uint cbSize;
            public int bIsOffload;
            public int eCategory;
            public int Options;
        }

        // ------------------------------------------------------ interfaces

        [GeneratedComInterface(StringMarshalling = StringMarshalling.Utf16)]
        [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
        public partial interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
            [PreserveSig] int GetDevice(string id, out IMMDevice device);
            [PreserveSig] int RegisterEndpointNotificationCallback(nint client);
            [PreserveSig] int UnregisterEndpointNotificationCallback(nint client);
        }

        [GeneratedComInterface]
        [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
        public partial interface IMMDeviceCollection
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int Item(int index, out IMMDevice device);
        }

        [GeneratedComInterface]
        [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
        public partial interface IMMDevice
        {
            [PreserveSig] int Activate(in Guid iid, int clsCtx, nint activationParams, out nint iface);
            [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore properties);
            [PreserveSig] int GetId(out nint id);
            [PreserveSig] int GetState(out int state);
        }

        [GeneratedComInterface]
        [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        public partial interface IPropertyStore
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int GetAt(int index, out PROPERTYKEY key);
            [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
        }

        /// <summary>
        /// IAudioClient2, with IAudioClient's slots spelled out first in its
        /// order rather than inherited: one table, read top to bottom.
        /// SetClientProperties is the one IAudioClient2 adds that voice uses.
        /// </summary>
        [GeneratedComInterface]
        [Guid("726778CD-F60A-4EDA-82DE-E47610CD78AA")]
        public partial interface IAudioClient2
        {
            [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, WAVEFORMATEXTENSIBLE* format, nint sessionGuid);
            [PreserveSig] int GetBufferSize(out uint frames);
            [PreserveSig] int GetStreamLatency(out long latency);
            [PreserveSig] int GetCurrentPadding(out uint frames);
            [PreserveSig] int IsFormatSupported(int shareMode, WAVEFORMATEXTENSIBLE* format, out nint closest);
            [PreserveSig] int GetMixFormat(out nint format);
            [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
            [PreserveSig] int Start();
            [PreserveSig] int Stop();
            [PreserveSig] int Reset();
            [PreserveSig] int SetEventHandle(nint handle);
            [PreserveSig] int GetService(in Guid iid, out nint service);
            [PreserveSig] int IsOffloadCapable(int category, out int capable);
            [PreserveSig] int SetClientProperties(AudioClientProperties* properties);
        }

        [GeneratedComInterface]
        [Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317")]
        public partial interface IAudioCaptureClient
        {
            [PreserveSig] int GetBuffer(out nint data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
            [PreserveSig] int ReleaseBuffer(uint frames);
            [PreserveSig] int GetNextPacketSize(out uint frames);
        }

        [GeneratedComInterface]
        [Guid("F294ACFC-3146-4483-A7BF-ADDCA7C260E2")]
        public partial interface IAudioRenderClient
        {
            [PreserveSig] int GetBuffer(uint frames, out nint data);
            [PreserveSig] int ReleaseBuffer(uint frames, uint flags);
        }

        /// <summary>
        /// IAudioSessionControl2, every IAudioSessionControl slot first, for
        /// SetDuckingPreference at the end.
        /// </summary>
        [GeneratedComInterface]
        [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
        public partial interface IAudioSessionControl2
        {
            [PreserveSig] int GetState(out int state);
            [PreserveSig] int GetDisplayName(out nint name);
            [PreserveSig] int SetDisplayName(nint name, nint eventContext);
            [PreserveSig] int GetIconPath(out nint path);
            [PreserveSig] int SetIconPath(nint path, nint eventContext);
            [PreserveSig] int GetGroupingParam(out Guid grouping);
            [PreserveSig] int SetGroupingParam(in Guid grouping, nint eventContext);
            [PreserveSig] int RegisterAudioSessionNotification(nint client);
            [PreserveSig] int UnregisterAudioSessionNotification(nint client);
            [PreserveSig] int GetSessionIdentifier(out nint id);
            [PreserveSig] int GetSessionInstanceIdentifier(out nint id);
            [PreserveSig] int GetProcessId(out uint pid);
            [PreserveSig] int IsSystemSoundsSession();
            [PreserveSig] int SetDuckingPreference(int optOut);
        }
    }
}
