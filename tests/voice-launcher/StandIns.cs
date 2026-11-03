using System;
using System.Diagnostics;
using System.Threading;

namespace Thornswood
{
    /*
      Stand-ins for the launcher files the voice session touches but that are
      not voice: Config, which the session only hands to VoiceAudio, Paths,
      where Swallow writes, and VoiceAudio itself, which is WASAPI and only
      runs on Windows.
    */

    sealed class Config { }

    static class Paths
    {
        // Swallow.Note's lines go to the file the harness names (--log), so a
        // swallowed exception is something a harness can read and fail on.
        public static string LogFile = "";
    }

    /// <summary>
    /// The microphone and the speakers, as the session sees VoiceAudio: Start,
    /// OnFrame with each 20 ms of the microphone, OnEvent with what it would
    /// say, and Dispose. The microphone is a tone of this driver's own pitch
    /// (--tone), so whoever hears it can tell whose voice it is; the speakers
    /// are the session's own mixer, rendered every 20 ms as VoiceAudio's
    /// playback thread renders it, into the last half second a harness asks
    /// about (Hear). Only with the real clock: on the clock a harness moves
    /// by hand there is no audio, only the session's words.
    /// </summary>
    sealed class VoiceAudio : IDisposable
    {
        public static double Tone = 440;
        public static bool Running = true;
        public static VoiceAudio Last;

        public Action<float[]> OnFrame = delegate { };
        public Action<string, string> OnEvent = delegate { };

        readonly VoiceMix mix;
        // The last half second, each ear on its own: left, right, left, ...
        readonly float[] heard = new float[VoiceMix.Rate];
        int at;
        readonly object gate = new object();
        volatile bool stop;
        Thread thread;

        public VoiceAudio(VoiceMix mix, Config cfg) { this.mix = mix; Last = this; }

        public void Start()
        {
            OnEvent("log", "microphone open: harness tone " + Tone + " Hz");
            OnEvent("status", "mic ready");
            if (!Running) return;
            thread = new Thread(Loop) { IsBackground = true, Name = "harness audio" };
            thread.Start();
        }

        void Loop()
        {
            var clock = Stopwatch.StartNew();
            long n = 0;
            var stereo = new float[VoiceMix.Frame * 2];
            while (!stop)
            {
                var frame = new float[VoiceMix.Frame];
                for (int i = 0; i < frame.Length; i++)
                    frame[i] = 0.3f * (float)Math.Sin(2 * Math.PI * Tone * (n * VoiceMix.Frame + i) / VoiceMix.Rate);
                OnFrame(frame);
                mix.Render(stereo, VoiceMix.Frame);
                lock (gate)
                {
                    for (int i = 0; i < 2 * VoiceMix.Frame; i++)
                    {
                        heard[at] = stereo[i];
                        at = (at + 1) % heard.Length;
                    }
                }
                n++;
                long due = n * 20 - clock.ElapsedMilliseconds;
                if (due > 0) Thread.Sleep((int)due);
            }
        }

        /// <summary>
        /// How loud each pitch plays: the tone's amplitude in each 40 ms of
        /// the last half second (Goertzel, through a Hann window), in each
        /// ear on its own, and the loudest of those. A voice heard in front
        /// at full level reads about 0.25 and a voice not heard reads about
        /// nothing (#5456).
        ///
        /// Each ear on its own, because that is how it is heard. The two
        /// ears were once averaged into one, and the panner delays the far
        /// ear of a voice to the side (VoiceMix.cs), so in the average the
        /// two ears partly cancelled by an amount that hangs on the pitch:
        /// on a quiet machine, four voices at the same level beside me read
        /// 0.148 at 500 Hz, 0.118 at 600, 0.100 at 700 and 0.133 at 800
        /// (2 Nov 2026), steady in every block.
        ///
        /// The loudest 40 ms, because the voice plays only while its audio
        /// arrives in time: the jitter buffer plays silence when it runs dry
        /// and waits 40 ms before it plays again (VoiceMix.cs). On a machine
        /// running several harnesses to a core, the five drivers' 20 ms
        /// loops fall behind, and blocks of a voice that is mixed in at its
        /// level read 0.002 between blocks of 0.13. Their average fell under
        /// the line (0.048 for a voice whose blocks reached 0.138, measured
        /// with twelve busy loops on four cores, 2 Nov 2026), and dropped
        /// #5454, #5327 and #5460 from the merge queue. Whether somebody is
        /// in the mix at their level is what the harnesses ask, not whether
        /// the machine kept up, and a voice left out of the mix reads about
        /// nothing in every block. A block holds at most one jump in the
        /// tone's phase (a drop or a refill), so the parts either side of a
        /// jump cannot cancel over the whole half second.
        /// </summary>
        public double Hear(double hz)
        {
            float[] copy = new float[heard.Length];
            int start;
            lock (gate) { Array.Copy(heard, copy, heard.Length); start = at; }
            // 40 ms, whose bins are 25 Hz apart: the harnesses' tones are 60 Hz or
            // more apart, outside each other's main lobe through the window.
            const int Block = VoiceMix.Rate / 25;
            int frames = copy.Length / 2, blocks = frames / Block, skip = frames - blocks * Block;
            double w = 2 * Math.PI * hz / VoiceMix.Rate, c = 2 * Math.Cos(w), loudest = 0;
            for (int b = 0; b < blocks; b++)
            {
                for (int ear = 0; ear < 2; ear++)
                {
                    double s1 = 0, s2 = 0;
                    for (int i = 0; i < Block; i++)
                    {
                        double hann = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / Block);
                        int frame = skip + b * Block + i;
                        double s0 = hann * copy[(start + 2 * frame + ear) % copy.Length] + c * s1 - s2;
                        s2 = s1; s1 = s0;
                    }
                    double power = s1 * s1 + s2 * s2 - c * s1 * s2;
                    // The Hann window sums to half the block.
                    loudest = Math.Max(loudest, 2 * Math.Sqrt(Math.Max(0, power)) / (Block / 2.0));
                }
            }
            return loudest;
        }

        public void Dispose()
        {
            stop = true;
            if (thread != null) thread.Join(1000);
        }
    }
}
