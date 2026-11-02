using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Thornswood
{
    /// <summary>
    /// Everybody this person can hear, mixed into one stereo stream for the
    /// speakers: what the voice page's Web Audio graph did, a PannerNode
    /// and a GainNode per person into the AudioContext's destination, worked
    /// out a render quantum of 128 frames at a time as Web Audio works it.
    ///
    /// The numbers are the page's. The panner is 'HRTF' (Patrick, 28 Sep,
    /// #963 point 4: every voice panner is HRTF, none cheaper), Chromium's own
    /// HRTF panner and data set ported in VoiceHrtf.cs, so above, below and
    /// behind sound as they did. The position goes to the panner as the
    /// page's positionX.value did, from the next quantum, and the panner's
    /// own crossfade carries a move. The distance model is the PannerNode's
    /// 'inverse' with refDistance 1 and rolloffFactor 0, which is 1 at every
    /// distance: the panner only places the voice, and how loud it is comes
    /// from the speaker's mode (levelFor in VoiceSession.cs). The level after
    /// the panner moves the way the page's setTargetAtTime(value, now, 0.05)
    /// moved it, an exponential approach with a 50 ms time constant, so a
    /// position a fifth of a second later does not click.
    ///
    /// Each person has a little buffer in front of the mix (jitter), because
    /// packets arrive in bursts and the speakers take samples evenly. It
    /// starts playing at 40 ms, plays out when it runs dry, and drops its
    /// oldest audio when more than 200 ms pile up, so a burst never becomes
    /// lasting delay.
    /// </summary>
    sealed class VoiceMix
    {
        public const int Rate = 48000;
        public const int Frame = 960;   // 20 ms

        const int Prime = Rate * 40 / 1000;
        const int Most = Rate * 200 / 1000;
        const int Keep = Rate * 60 / 1000;

        // setTargetAtTime's time constant, 0.05 s, as a per sample step.
        static readonly float Approach = (float)(1 - Math.Exp(-1.0 / (0.05 * Rate)));

        // The PannerNode's distance settings, as the page set them.
        const double RefDistance = 1;
        const double RolloffFactor = 0;

        const int Quantum = HrtfPanner.Quantum;

        sealed class Source
        {
            public readonly float[] Ring = new float[Rate];
            public int Read, Count;
            public bool Primed;
            public bool Audible = true;
            public float Gain = 1, GainTarget = 1;
            // Where the page's PannerNode starts: at the listener, which is
            // straight ahead.
            public double Azimuth, Elevation;
            public float Distance = 1;
            public readonly HrtfPanner Panner;
            // This quantum, as taken under the lock: the voice, where it is
            // and the level it is going to.
            public readonly float[] In = new float[Quantum];
            public double QAzimuth, QElevation;
            public float QTarget, QDistance;
            public Source(Task<HrtfDatabase> hrtf) { Panner = new HrtfPanner(hrtf, Rate); }
        }

        readonly object gate = new object();
        readonly Dictionary<int, Source> sources = new Dictionary<int, Source>();
        // The HRTF data, built on the thread pool from the first mix on.
        readonly Task<HrtfDatabase> hrtf = HrtfDatabase.Shared();
        // One quantum of the mix, and how much of it the speakers have had.
        readonly float[] mixL = new float[Quantum], mixR = new float[Quantum];
        readonly float[] panL = new float[Quantum], panR = new float[Quantum];
        readonly List<Source> work = new List<Source>();
        int mixAt = Quantum;

        /// <summary>The HRTF data's build, for the session to say when it fails.</summary>
        public Task Hrtf { get { return hrtf; } }

        Source At(int id)
        {
            Source s;
            if (!sources.TryGetValue(id, out s)) { s = new Source(hrtf); sources[id] = s; }
            return s;
        }

        /// <summary>
        /// Starts a person silent, as the page started a gain node at 0 for
        /// somebody already muted, so nothing is heard before the first
        /// position says how loud they are.
        /// </summary>
        public void Add(int id, bool silent)
        {
            lock (gate)
            {
                Source s = At(id);
                if (silent) { s.Gain = 0; s.GainTarget = 0; }
            }
        }

        public void Remove(int id)
        {
            lock (gate) sources.Remove(id);
        }

        /// <summary>Decoded audio from one person, mono at 48 kHz.</summary>
        public void Push(int id, ReadOnlySpan<float> pcm)
        {
            lock (gate)
            {
                Source s;
                if (!sources.TryGetValue(id, out s) || !s.Audible) return;
                int n = Math.Min(pcm.Length, s.Ring.Length);
                for (int i = 0; i < n; i++)
                {
                    s.Ring[(s.Read + s.Count) % s.Ring.Length] = pcm[i];
                    if (s.Count < s.Ring.Length) s.Count++;
                    else s.Read = (s.Read + 1) % s.Ring.Length;
                }
                if (s.Count > Most)
                {
                    int drop = s.Count - Keep;
                    s.Read = (s.Read + drop) % s.Ring.Length;
                    s.Count -= drop;
                }
            }
        }

        /// <summary>The gain node's value, approached as setTargetAtTime approached it.</summary>
        public void SetLevel(int id, double level)
        {
            lock (gate)
            {
                Source s;
                if (sources.TryGetValue(id, out s)) s.GainTarget = (float)level;
            }
        }

        /// <summary>
        /// Whether this person's audio is taken at all: the page's hear(),
        /// which turned their incoming track off for a mute or a staff
        /// silence, so nothing of theirs played whatever the gain said.
        /// </summary>
        public void SetAudible(int id, bool on)
        {
            lock (gate)
            {
                Source s;
                if (!sources.TryGetValue(id, out s)) return;
                s.Audible = on;
                if (!on) { s.Count = 0; s.Primed = false; }
            }
        }

        /// <summary>
        /// Where the voice is, in the listener's frame as the page gave it to
        /// the PannerNode: x to the right, y up, z behind (so what is in
        /// front is negative z). The listener is Web Audio's default, at the
        /// origin facing -z with +y up.
        /// </summary>
        public void SetPosition(int id, double x, double y, double z)
        {
            double azimuth, elevation;
            // An AudioParam holds a float.
            HrtfPanner.Azimuth((float)x, (float)y, (float)z, out azimuth, out elevation);
            float d = (float)DistanceGain(Math.Sqrt(x * x + y * y + z * z));
            lock (gate)
            {
                Source s;
                if (!sources.TryGetValue(id, out s)) return;
                s.Azimuth = azimuth;
                s.Elevation = elevation;
                s.Distance = d;
            }
        }

        /// <summary>
        /// The PannerNode's 'inverse' distance model:
        /// ref / (ref + rolloff * (max(d, ref) - ref)). With the page's
        /// rolloffFactor of 0 it is 1 wherever the voice is.
        /// </summary>
        public static double DistanceGain(double distance)
        {
            double d = Math.Max(distance, RefDistance);
            return RefDistance / (RefDistance + RolloffFactor * (d - RefDistance));
        }

        /// <summary>
        /// The next frames for the speakers, interleaved left and right,
        /// everybody summed and held inside -1 to 1.
        /// </summary>
        /// <remarks>Called by one thread only, the speakers'.</remarks>
        public void Render(Span<float> stereo, int frames)
        {
            for (int i = 0; i < frames; i++)
            {
                if (mixAt == Quantum) { RenderQuantum(); mixAt = 0; }
                float l = mixL[mixAt], r = mixR[mixAt];
                mixAt++;
                stereo[2 * i] = l > 1 ? 1 : l < -1 ? -1 : l;
                stereo[2 * i + 1] = r > 1 ? 1 : r < -1 ? -1 : r;
            }
        }

        /// <summary>
        /// One render quantum: each person's next 128 frames out of their
        /// buffer (silence while it fills or when it has run dry), through
        /// their panner, times their level, summed. Only taking the frames
        /// is done under the lock, so a packet arriving never waits on the
        /// filtering; the panners and levels are this thread's alone.
        /// </summary>
        void RenderQuantum()
        {
            work.Clear();
            lock (gate)
            {
                foreach (Source s in sources.Values)
                {
                    if (!s.Primed && s.Count >= Prime) s.Primed = true;
                    for (int i = 0; i < Quantum; i++)
                    {
                        if (!s.Primed || s.Count == 0) { s.Primed = false; s.In[i] = 0; continue; }
                        s.In[i] = s.Ring[s.Read];
                        s.Read = (s.Read + 1) % s.Ring.Length;
                        s.Count--;
                    }
                    s.QAzimuth = s.Azimuth;
                    s.QElevation = s.Elevation;
                    s.QTarget = s.GainTarget;
                    s.QDistance = s.Distance;
                    work.Add(s);
                }
            }
            Array.Clear(mixL);
            Array.Clear(mixR);
            foreach (Source s in work)
            {
                s.Panner.Pan(s.QAzimuth, s.QElevation, s.In, panL, panR);
                for (int i = 0; i < Quantum; i++)
                {
                    s.Gain += (s.QTarget - s.Gain) * Approach;
                    float g = s.Gain * s.QDistance;
                    mixL[i] += panL[i] * g;
                    mixR[i] += panR[i] * g;
                }
            }
        }
    }
}
