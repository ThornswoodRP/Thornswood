using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

namespace Thornswood
{
    /// <summary>
    /// Voice and launcher music use different Windows audio APIs. A Core
    /// Audio endpoint ID identifies the same output in both APIs, including
    /// when two endpoints have the same friendly name.
    /// </summary>
    static partial class AudioOutput
    {
        public sealed record Device(string Id, string Name);

        public const int WaveMapper = -1;
        // mmddk.h. waveOutMessage addresses the device number directly for
        // these messages, without first opening a waveform stream.
        const uint QueryFunctionInstanceId = 0x0811;
        const uint QueryFunctionInstanceIdSize = 0x0812;

        public static List<Device> All()
        {
            var outputs = new List<Device>();
            bool entered = VoiceCom.Enter();
            VoiceCom.IMMDeviceEnumerator enumerator = null;
            VoiceCom.IMMDeviceCollection collection = null;
            try
            {
                enumerator = VoiceCom.Enumerator(out _);
                if (enumerator == null ||
                    enumerator.EnumAudioEndpoints(VoiceCom.eRender, VoiceCom.DEVICE_STATE_ACTIVE, out collection) != 0 ||
                    collection == null || collection.GetCount(out int count) != 0)
                    return outputs;

                for (int index = 0; index < count; index++)
                {
                    VoiceCom.IMMDevice device = null;
                    try
                    {
                        if (collection.Item(index, out device) != 0 || device == null) continue;
                        string id = VoiceCom.IdOf(device);
                        string name = VoiceCom.NameOf(device);
                        if (id.Length > 0 && name.Length > 0) outputs.Add(new Device(id, name));
                    }
                    finally { VoiceCom.Release(device); }
                }
            }
            catch (Exception ex) { Swallow.Note("AudioOutput.All, audio endpoints", ex); }
            finally
            {
                VoiceCom.Release(collection);
                VoiceCom.Release(enumerator);
                VoiceCom.Leave(entered);
            }
            return outputs;
        }

        // The caller owns the returned COM interface. Windows may still
        // have a device registered after it becomes disconnected or disabled.
        public static int OpenForVoice(VoiceCom.IMMDeviceEnumerator enumerator, string id,
            out VoiceCom.IMMDevice device)
        {
            device = null;
            if (!string.IsNullOrEmpty(id))
            {
                VoiceCom.IMMDevice selected = null;
                try
                {
                    if (enumerator.GetDevice(id, out selected) == 0 && selected != null &&
                        selected.GetState(out int state) == 0 && state == VoiceCom.DEVICE_STATE_ACTIVE)
                    {
                        device = selected;
                        selected = null;
                        return 0;
                    }
                }
                finally { VoiceCom.Release(selected); }
            }
            return enumerator.GetDefaultAudioEndpoint(VoiceCom.eRender, VoiceCom.eConsole, out device);
        }

        public static unsafe int WaveOutIndex(string id)
        {
            if (string.IsNullOrEmpty(id)) return WaveMapper;
            uint count = waveOutGetNumDevs();
            for (uint index = 0; index < count; index++)
            {
                uint bytes = 0;
                if (waveOutMessage((nint)index, QueryFunctionInstanceIdSize, (nuint)(&bytes), 0) != 0 ||
                    bytes < sizeof(char) || bytes > 32768 || bytes % sizeof(char) != 0)
                    continue;

                var buffer = new char[bytes / sizeof(char)];
                fixed (char* data = buffer)
                {
                    if (waveOutMessage((nint)index, QueryFunctionInstanceId, (nuint)data, bytes) != 0)
                        continue;
                }
                int length = Array.IndexOf(buffer, '\0');
                if (length > 0 && buffer.AsSpan(0, length).Equals(id.AsSpan(), StringComparison.OrdinalIgnoreCase))
                    return (int)index;
            }
            return WaveMapper;
        }

        [LibraryImport("winmm.dll")]
        private static partial uint waveOutGetNumDevs();

        // The game reads this machine-local preference before it opens
        // its audio engine. An empty file is an explicit Windows default.
        public static void PrepareGame(string gameDirectory, string outputId)
        {
            string destination = Path.Combine(gameDirectory, "Data", "SKSE", "Plugins", "ThornswoodAudioOutput.txt");
            string staged = destination + "." + Guid.NewGuid().ToString("N");
            try
            {
                File.WriteAllText(staged, outputId ?? "");
                File.Move(staged, destination, overwrite: true);
            }
            finally
            {
                try { File.Delete(staged); }
                catch (Exception ex) { Swallow.Note("AudioOutput.PrepareGame, remove staging file", ex); }
            }
        }

        [LibraryImport("winmm.dll")]
        private static partial uint waveOutMessage(nint device, uint message, nuint param1, nuint param2);
    }
}
