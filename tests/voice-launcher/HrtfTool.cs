using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text.Json;

namespace Thornswood
{
    /*
      The launcher's HRTF panner (VoiceHrtf.cs) on its own, for
      tests\test-voice-hrtf.js:

        --hrtf fft                     the FFT against a plain DFT, and back.
        --hrtf render in.f32 moves.json out.f32
                                       a mono 48 kHz signal through one panner,
                                       a render quantum at a time, moved where
                                       moves.json says ([{"q":quantum,"x","y",
                                       "z"}], set from that quantum on, as the
                                       page's positionX.value was); out is
                                       interleaved left and right.
        --hrtf azimuth moves.json      the azimuth and elevation of each place.
        --hrtf bench peers seconds     how long the data takes to build, and the
                                       mix's cost per person talking and per
                                       person silent, in CPU time.

      Every result is one JSON line on stdout.
    */
    static class HrtfTool
    {
        public static int Run(string[] args)
        {
            switch (args.Length > 1 ? args[1] : "")
            {
                case "fft": return Fft();
                case "render": return Render(args[2], args[3], args[4]);
                case "azimuth": return Azimuths(args[2]);
                case "bench": return Bench(int.Parse(args[2], CultureInfo.InvariantCulture), double.Parse(args[3], CultureInfo.InvariantCulture));
                default: Console.Error.WriteLine("--hrtf fft | render | azimuth | bench"); return 2;
            }
        }

        static void Say(Dictionary<string, object> o) { Console.Out.WriteLine(JsonSerializer.Serialize(o)); }

        static int Fft()
        {
            var rnd = new Random(7);
            double worstForward = 0, worstBack = 0;
            foreach (int n in new[] { 4, 8, 256, 512 })
            {
                var x = new float[n];
                for (int i = 0; i < n; i++) x[i] = (float)(rnd.NextDouble() * 2 - 1);
                var fft = new HrtfFft(n);
                var re = new float[n / 2];
                var im = new float[n / 2];
                fft.Forward(x, re, im);
                for (int k = 0; k <= n / 2; k++)
                {
                    double sr = 0, si = 0;
                    for (int t = 0; t < n; t++) { sr += x[t] * Math.Cos(2 * Math.PI * k * t / n); si -= x[t] * Math.Sin(2 * Math.PI * k * t / n); }
                    double gr, gi;
                    if (k == 0) { gr = re[0]; gi = 0; }
                    else if (k == n / 2) { gr = im[0]; gi = 0; }
                    else { gr = re[k]; gi = im[k]; }
                    worstForward = Math.Max(worstForward, Math.Max(Math.Abs(gr - sr), Math.Abs(gi - si)) / n);
                }
                var back = new float[n];
                fft.Inverse(re, im, back);
                for (int i = 0; i < n; i++) worstBack = Math.Max(worstBack, Math.Abs(back[i] - x[i]));
            }
            Say(new Dictionary<string, object> { { "forward", worstForward }, { "back", worstBack } });
            return 0;
        }

        struct Move { public int Q; public float X, Y, Z; }

        static List<Move> Moves(string file)
        {
            var list = new List<Move>();
            using (JsonDocument d = JsonDocument.Parse(File.ReadAllText(file)))
            {
                foreach (JsonElement e in d.RootElement.EnumerateArray())
                    list.Add(new Move
                    {
                        Q = e.TryGetProperty("q", out JsonElement q) ? q.GetInt32() : 0,
                        X = e.GetProperty("x").GetSingle(),
                        Y = e.GetProperty("y").GetSingle(),
                        Z = e.GetProperty("z").GetSingle(),
                    });
            }
            return list;
        }

        static int Azimuths(string file)
        {
            var az = new List<double>();
            var el = new List<double>();
            foreach (Move m in Moves(file))
            {
                double a, e;
                HrtfPanner.Azimuth(m.X, m.Y, m.Z, out a, out e);
                az.Add(a); el.Add(e);
            }
            Say(new Dictionary<string, object> { { "azimuth", az }, { "elevation", el } });
            return 0;
        }

        static int Render(string inFile, string movesFile, string outFile)
        {
            byte[] raw = File.ReadAllBytes(inFile);
            var input = new float[raw.Length / 4];
            Buffer.BlockCopy(raw, 0, input, 0, input.Length * 4);
            List<Move> moves = Moves(movesFile);
            var hrtf = HrtfDatabase.Shared();
            hrtf.Wait();
            var panner = new HrtfPanner(hrtf, VoiceMix.Rate);
            int q = HrtfPanner.Quantum, quanta = (input.Length + q - 1) / q;
            var output = new float[quanta * q * 2];
            var block = new float[q];
            var l = new float[q];
            var r = new float[q];
            double az = 0, el = 0;
            int next = 0;
            for (int n = 0; n < quanta; n++)
            {
                while (next < moves.Count && moves[next].Q <= n)
                {
                    HrtfPanner.Azimuth(moves[next].X, moves[next].Y, moves[next].Z, out az, out el);
                    next++;
                }
                Array.Clear(block);
                Array.Copy(input, n * q, block, 0, Math.Min(q, input.Length - n * q));
                panner.Pan(az, el, block, l, r);
                for (int i = 0; i < q; i++) { output[2 * (n * q + i)] = l[i]; output[2 * (n * q + i) + 1] = r[i]; }
            }
            var bytes = new byte[input.Length * 8];
            Buffer.BlockCopy(output, 0, bytes, 0, bytes.Length);
            File.WriteAllBytes(outFile, bytes);
            Say(new Dictionary<string, object> { { "frames", input.Length } });
            return 0;
        }

        /*
          The data's build, timed on its own, then the mix as the speakers run
          it: everybody pushed 20 ms of audio, then 20 ms rendered, over and
          over, timed on this one thread with nothing else to do, so the time
          it takes is the CPU it costs. Once with everybody
          talking (noise), once with everybody silent, against the same mix
          with nobody in it.
        */
        static int Bench(int peers, double seconds)
        {
            var sw = Stopwatch.StartNew();
            new HrtfDatabase(VoiceMix.Rate);
            double buildMs = sw.Elapsed.TotalMilliseconds;
            HrtfDatabase.Shared().Wait();

            double Run(int count, bool talking)
            {
                var mix = new VoiceMix();
                var rnd = new Random(3);
                for (int p = 0; p < count; p++)
                {
                    mix.Add(p, false);
                    mix.SetPosition(p, Math.Cos(p), 0.3 * Math.Sin(3 * p), Math.Sin(p));
                }
                var frame = new float[VoiceMix.Frame];
                var stereo = new float[VoiceMix.Frame * 2];
                int frames = (int)(seconds * 50);
                // Warm up, so the JIT and the jitter buffers are settled.
                for (int f = 0; f < frames + 50; f++)
                {
                    if (f == 50) sw.Restart();
                    for (int p = 0; p < count; p++)
                    {
                        for (int i = 0; i < frame.Length; i++) frame[i] = talking ? (float)(rnd.NextDouble() * 0.2 - 0.1) : 0;
                        mix.Push(p, frame);
                    }
                    // Moving every half second, so the crossfades are counted.
                    if (f % 25 == 0) for (int p = 0; p < count; p++) mix.SetPosition(p, Math.Cos(p + f), 0.2, Math.Sin(p + f));
                    mix.Render(stereo, VoiceMix.Frame);
                }
                return sw.Elapsed.TotalMilliseconds / (frames * 20.0);
            }

            double empty = Run(0, true);
            double talk = Run(peers, true);
            double quiet = Run(peers, false);
            Say(new Dictionary<string, object>
            {
                { "buildMs", buildMs },
                { "peers", peers },
                { "coreShareEmpty", empty },
                { "coreSharePerTalker", (talk - empty) / peers },
                { "coreSharePerSilent", (quiet - empty) / peers },
            });
            return 0;
        }
    }
}
