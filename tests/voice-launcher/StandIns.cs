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
        readonly float[] heard = new float[VoiceMix.Rate / 2];   // mono, the last half second
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
                    for (int i = 0; i < VoiceMix.Frame; i++)
                    {
                        heard[at] = (stereo[2 * i] + stereo[2 * i + 1]) / 2;
                        at = (at + 1) % heard.Length;
                    }
                }
                n++;
                long due = n * 20 - clock.ElapsedMilliseconds;
                if (due > 0) Thread.Sleep((int)due);
            }
        }

        /// <summary>
        /// How loud each pitch is in what played over the last half second:
        /// the amplitude of that tone (Goertzel), so a voice heard in front at
        /// full level reads about 0.25 (the tone through the HRTF panner,
        /// both ears averaged), and a voice not heard reads about nothing.
        /// </summary>
        public double Hear(double hz)
        {
            float[] copy = new float[heard.Length];
            int start;
            lock (gate) { Array.Copy(heard, copy, heard.Length); start = at; }
            double w = 2 * Math.PI * hz / VoiceMix.Rate, c = 2 * Math.Cos(w), s1 = 0, s2 = 0;
            for (int i = 0; i < copy.Length; i++)
            {
                double s0 = copy[(start + i) % copy.Length] + c * s1 - s2;
                s2 = s1; s1 = s0;
            }
            double power = s1 * s1 + s2 * s2 - c * s1 * s2;
            return 2 * Math.Sqrt(Math.Max(0, power)) / copy.Length;
        }

        public void Dispose()
        {
            stop = true;
            if (thread != null) thread.Join(1000);
        }
    }
}
