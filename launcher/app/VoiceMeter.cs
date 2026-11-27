using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;

namespace Thornswood
{
    // Levels and counts only. Never retains samples, identities or packets.
    // One lock per audio buffer, never per render sample; formatting is outside it.
    sealed class VoiceMeter
    {
        sealed class Level
        {
            public long Samples, Nonfinite;
            public double Squares, Peak;
            public void Add(ReadOnlySpan<float> pcm)
            {
                Samples += pcm.Length;
                foreach (float f in pcm)
                {
                    if (!float.IsFinite(f)) { Nonfinite++; continue; }
                    Peak = Math.Max(Peak, Math.Abs((double)f));
                    Squares += (double)f * f;
                }
            }
        }
        sealed class Source
        {
            public int Id;
            public bool Audible = true;
            public double Target = 1, Gain = 1, Metres;
            public string Reason = "unplaced";
            public Level Decoded = new Level(), Accepted = new Level();
            public Source Copy() { return (Source)MemberwiseClone(); }
        }
        readonly object gate = new object();
        readonly Dictionary<int, Source> sources = new Dictionary<int, Source>();
        Level capture = new Level(), decoded = new Level(), accepted = new Level(), rendered = new Level();
        long captureFrames, captureLiveFrames, encodedPackets, encodedBytes, protectedPackets, sendCalls, unknownChunks;

        public void Add(int id, bool silent)
        {
            lock (gate) sources[id] = new Source { Id = id, Audible = !silent, Target = silent ? 0 : 1, Gain = silent ? 0 : 1 };
        }
        public void Remove(int id) { lock (gate) sources.Remove(id); }
        public void State(int id, double target, bool audible, double gain, double metres, string reason)
        {
            lock (gate)
            {
                Source s;
                if (!sources.TryGetValue(id, out s)) return;
                s.Target = target; s.Audible = audible; s.Gain = gain; s.Metres = metres; s.Reason = reason;
            }
        }
        public void Capture(float[] pcm, bool live)
        {
            lock (gate) { captureFrames++; if (live) captureLiveFrames++; capture.Add(pcm); }
        }
        public void Encoded(int bytes) { lock (gate) { encodedPackets++; encodedBytes += bytes; } }
        public void Protected() { lock (gate) protectedPackets++; }
        // Counts handoffs to ICE, not delivery: UDP has no delivery acknowledgement.
        public void SendCall() { lock (gate) sendCalls++; }
        public void Decoded(int id, ReadOnlySpan<float> pcm, int acceptedSamples)
        {
            lock (gate)
            {
                decoded.Add(pcm);
                ReadOnlySpan<float> take = pcm.Slice(0, acceptedSamples);
                accepted.Add(take);
                Source s;
                if (!sources.TryGetValue(id, out s)) { unknownChunks++; return; }
                s.Decoded.Add(pcm); s.Accepted.Add(take);
            }
        }
        public void Rendered(ReadOnlySpan<float> pcm) { lock (gate) rendered.Add(pcm); }

        static void Finite(Utf8JsonWriter w, string name, double value)
        {
            if (double.IsFinite(value)) w.WriteNumber(name, value); else w.WriteNull(name);
        }
        static void Write(Utf8JsonWriter w, string name, Level l)
        {
            w.WriteStartObject(name);
            w.WriteNumber("samples", l.Samples); w.WriteNumber("nonfinite", l.Nonfinite);
            Finite(w, "peak", l.Peak);
            long finite = l.Samples - l.Nonfinite;
            Finite(w, "rms", finite > 0 ? Math.Sqrt(l.Squares / finite) : 0);
            w.WriteEndObject();
        }
        public string Summary(long intervalMs)
        {
            Level c, d, a, r;
            long cf, cl, ep, eb, pp, sc, unknown;
            int peers;
            var rows = new List<Source>(8);
            lock (gate)
            {
                c = capture; d = decoded; a = accepted; r = rendered;
                cf = captureFrames; cl = captureLiveFrames; ep = encodedPackets; eb = encodedBytes;
                pp = protectedPackets; sc = sendCalls; unknown = unknownChunks; peers = sources.Count;
                capture = new Level(); decoded = new Level(); accepted = new Level(); rendered = new Level();
                captureFrames = captureLiveFrames = encodedPackets = encodedBytes = protectedPackets = sendCalls = unknownChunks = 0;
                foreach (Source s in sources.Values)
                {
                    if (rows.Count < 8) rows.Add(s.Copy());
                    s.Decoded = new Level(); s.Accepted = new Level();
                }
            }
            using (var bytes = new MemoryStream())
            {
                using (var w = new Utf8JsonWriter(bytes))
                {
                    w.WriteStartObject(); w.WriteNumber("intervalMs", Math.Max(0, intervalMs));
                    w.WriteNumber("captureFrames", cf); w.WriteNumber("captureLiveFrames", cl);
                    w.WriteNumber("encodedPackets", ep); w.WriteNumber("encodedBytes", eb);
                    w.WriteNumber("protectedPackets", pp); w.WriteNumber("sendCalls", sc);
                    w.WriteNumber("unknownChunks", unknown); w.WriteNumber("peers", peers); w.WriteNumber("omitted", peers - rows.Count);
                    Write(w, "capture", c); Write(w, "decoded", d); Write(w, "accepted", a); Write(w, "rendered", r);
                    w.WriteStartArray("sources");
                    foreach (Source s in rows)
                    {
                        w.WriteStartObject(); w.WriteNumber("peer", s.Id); w.WriteBoolean("audible", s.Audible);
                        Finite(w, "target", s.Target); Finite(w, "gain", s.Gain); Finite(w, "metres", s.Metres);
                        w.WriteString("reason", s.Reason); Write(w, "decoded", s.Decoded); Write(w, "accepted", s.Accepted);
                        w.WriteEndObject();
                    }
                    w.WriteEndArray(); w.WriteEndObject();
                }
                return Encoding.UTF8.GetString(bytes.ToArray());
            }
        }
    }

    /// <summary>
    /// Whether the microphone sends any sound while push to talk is held
    /// (#6470).
    ///
    /// The Dev playtest of 19 Nov 2026 that reproduced one way voice: one PC's
    /// Windows communications microphone was a headset's "Game" endpoint,
    /// which gave the launcher digital silence. Its capture peaked at 6.7e-11
    /// over more than 5,000 frames with push to talk held, and the launcher
    /// encoded and sent every one of them, so the other side decoded Opus
    /// silence (3.05e-5) and heard nothing. Nobody was told. The indicator
    /// lights from push to talk, not from sound, so both people saw it lit.
    /// Every working microphone in the 71 uploaded log sets since 18 Nov
    /// peaked between 0.08 and 1.0 while held.
    ///
    /// So a held microphone whose every sample stays under Floor for Frames
    /// frames in a row is silent, and the first frame over it is not. Frames
    /// not held are not counted: a microphone is only expected to carry a
    /// voice while somebody is talking into it.
    /// </summary>
    sealed class MicSilence
    {
        // About -100 dBFS, far under any microphone's own noise and far over
        // the 6.7e-11 the silent endpoint gave.
        public const float Floor = 1e-5f;
        // Five seconds of 20 ms frames held with nothing in them.
        public const int Frames = 250;

        int quiet;
        public bool Silent { get; private set; }

        /// <summary>
        /// One 20 ms frame taken while push to talk is held. Says +1 when
        /// this frame makes the microphone silent, -1 when it ends a silence,
        /// and 0 when nothing changed.
        /// </summary>
        public int Held(float[] pcm)
        {
            bool sound = false;
            foreach (float f in pcm)
            {
                if (f >= Floor || f <= -Floor) { sound = true; break; }
            }
            if (sound)
            {
                quiet = 0;
                if (!Silent) return 0;
                Silent = false;
                return -1;
            }
            if (Silent || ++quiet < Frames) return 0;
            Silent = true;
            return 1;
        }
    }
}
