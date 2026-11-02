using System;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;

/*
  The HRTF panner the voice page had: Web Audio's PannerNode with
  panningModel 'HRTF' as Chromium runs it, ported to C# (#963 point 4, #4823).

  Every voice is filtered for each ear by a pair of measured head related
  impulse responses, picked by the voice's azimuth and elevation, with the
  difference in arrival time between the ears as a delay line in front of
  each. It is Blink's HRTFPanner, HRTFDatabase, HRTFElevation, HRTFKernel,
  FFTFrame, FFTConvolver and Delay, the panner's azimuth and elevation from
  PannerHandler, and the SincResampler that brings the responses from
  44.1 kHz to the mix's 48 kHz, as they were at Chromium commit dd2ed7a2
  (1 November 2026), step for step, with the same constants and the same
  order of operations. The impulse responses are the same data set:
  Chromium's Composite.flac (launcher\hrtf-composite.wav here, the same
  samples as 16-bit PCM), 240 stereo responses of 256 frames from the IRCAM
  Listen database. THIRD-PARTY.md says where each part is from and under
  which terms, and installer\licences carries the texts.

  What it costs and where it runs is measured by tests\test-voice-hrtf.js,
  which also renders the same signal through Chrome's own PannerNode and
  compares the two sample by sample.
*/
namespace Thornswood
{
    /// <summary>
    /// A real FFT of a power of two size, packed as Blink's FFTFrame packs it:
    /// Re[0] is the DC term and Im[0] the Nyquist term, Re[k] and Im[k] the
    /// rest, k below Size/2. Forward is unscaled and inverse scales by
    /// 1/Size, as Blink's rustfft_ffi.rs does, by a complex FFT of half the
    /// size and the same reconstruction. One instance per user: it has its
    /// own scratch.
    /// </summary>
    sealed class HrtfFft
    {
        public readonly int Size;
        readonly int half, limit;
        readonly int[] rev;
        readonly float[] wr, wi;   // exp(-2 pi i k / half), k < half / 2
        readonly float[] tr, ti;   // 0.5 exp(-2 pi i k / Size), k < half
        readonly float[] zr, zi;

        public HrtfFft(int size)
        {
            Size = size;
            half = size / 2;
            limit = (half - 1) / 2;
            rev = new int[half];
            int bits = 0;
            while ((1 << bits) < half) bits++;
            for (int i = 0; i < half; i++)
            {
                int r = 0;
                for (int b = 0; b < bits; b++) if ((i & (1 << b)) != 0) r |= 1 << (bits - 1 - b);
                rev[i] = r;
            }
            wr = new float[Math.Max(1, half / 2)];
            wi = new float[wr.Length];
            for (int k = 0; k < half / 2; k++)
            {
                double a = -2 * Math.PI * k / half;
                wr[k] = (float)Math.Cos(a);
                wi[k] = (float)Math.Sin(a);
            }
            tr = new float[half];
            ti = new float[half];
            for (int k = 0; k < half; k++)
            {
                double a = -2 * Math.PI * k / size;
                tr[k] = (float)(0.5 * Math.Cos(a));
                ti[k] = (float)(0.5 * Math.Sin(a));
            }
            zr = new float[half];
            zi = new float[half];
        }

        void Complex(bool inverse)
        {
            int n = half;
            for (int i = 0; i < n; i++)
            {
                int j = rev[i];
                if (j > i)
                {
                    float t = zr[i]; zr[i] = zr[j]; zr[j] = t;
                    t = zi[i]; zi[i] = zi[j]; zi[j] = t;
                }
            }
            for (int len = 2; len <= n; len <<= 1)
            {
                int h = len >> 1, step = n / len;
                for (int s = 0; s < n; s += len)
                {
                    for (int k = 0; k < h; k++)
                    {
                        float c = wr[k * step], d = inverse ? -wi[k * step] : wi[k * step];
                        int a = s + k, b = a + h;
                        float xr = zr[b] * c - zi[b] * d;
                        float xi = zr[b] * d + zi[b] * c;
                        zr[b] = zr[a] - xr; zi[b] = zi[a] - xi;
                        zr[a] += xr; zi[a] += xi;
                    }
                }
            }
        }

        public void Forward(ReadOnlySpan<float> data, float[] re, float[] im)
        {
            for (int n = 0; n < half; n++) { zr[n] = data[2 * n]; zi[n] = data[2 * n + 1]; }
            Complex(false);
            re[0] = zr[0] + zi[0];
            im[0] = zr[0] - zi[0];
            for (int k = 1; k <= limit; k++)
            {
                float zkr = zr[k], zki = zi[k], zmr = zr[half - k], zmi = zi[half - k];
                float fer = 0.5f * (zkr + zmr), fei = 0.5f * (zki - zmi);
                float fr = zki + zmi, fi = -(zkr - zmr);
                float wfr = tr[k] * fr - ti[k] * fi, wfi = tr[k] * fi + ti[k] * fr;
                re[k] = fer + wfr; im[k] = fei + wfi;
                re[half - k] = fer - wfr; im[half - k] = -(fei - wfi);
            }
            if (half % 2 == 0 && half > 1) { int m = half / 2; re[m] = zr[m]; im[m] = -zi[m]; }
        }

        public void Inverse(float[] re, float[] im, Span<float> data)
        {
            zr[0] = 0.5f * (re[0] + im[0]);
            zi[0] = 0.5f * (re[0] - im[0]);
            for (int k = 1; k <= limit; k++)
            {
                float xkr = re[k], xki = im[k], xmr = re[half - k], xmi = -im[half - k];
                float fer = (xkr + xmr) * 0.5f, fei = (xki + xmi) * 0.5f;
                float dr = xkr - xmr, di = xki - xmi;
                float fr = tr[k] * dr + ti[k] * di, fi = tr[k] * di - ti[k] * dr;
                float ifr = -fi, ifi = fr;
                zr[k] = fer + ifr; zi[k] = fei + ifi;
                zr[half - k] = fer - ifr; zi[half - k] = -(fei - ifi);
            }
            if (half % 2 == 0 && half > 1) { int m = half / 2; zr[m] = re[m]; zi[m] = -im[m]; }
            Complex(true);
            float scale = 1f / half;
            for (int n = 0; n < half; n++) { data[2 * n] = zr[n] * scale; data[2 * n + 1] = zi[n] * scale; }
        }
    }

    /// <summary>Blink's FFTFrame: one packed spectrum and what is done to it.</summary>
    sealed class HrtfFrame
    {
        public readonly int Size;
        public readonly float[] Re, Im;

        public HrtfFrame(int size) { Size = size; Re = new float[size / 2]; Im = new float[size / 2]; }

        public void DoFft(HrtfFft fft, ReadOnlySpan<float> data) { fft.Forward(data, Re, Im); }
        public void DoInverseFft(HrtfFft fft, Span<float> data) { fft.Inverse(Re, Im, data); }

        public void DoPaddedFft(HrtfFft fft, ReadOnlySpan<float> data)
        {
            var padded = new float[Size];
            data.CopyTo(padded);
            DoFft(fft, padded);
        }

        /// <summary>
        /// FFTFrame::CreateInterpolatedFrame: the two spectra blended (magnitude
        /// in decibels, group delay by unwrapped phase), and the second half of
        /// the result's time domain zeroed so a convolution with it does not
        /// wrap around.
        /// </summary>
        public static HrtfFrame Interpolated(HrtfFrame f1, HrtfFrame f2, double x, HrtfFft fft)
        {
            var frame = new HrtfFrame(f1.Size);
            frame.InterpolateFrequencyComponents(f1, f2, x);
            var buffer = new float[frame.Size];
            frame.DoInverseFft(fft, buffer);
            Array.Clear(buffer, frame.Size / 2, frame.Size / 2);
            frame.DoFft(fft, buffer);
            return frame;
        }

        void InterpolateFrequencyComponents(HrtfFrame frame1, HrtfFrame frame2, double interp)
        {
            float[] real1 = frame1.Re, imag1 = frame1.Im, real2 = frame2.Re, imag2 = frame2.Im;
            double s1base = 1.0 - interp, s2base = interp;
            double phaseAccum = 0, lastPhase1 = 0, lastPhase2 = 0;
            Re[0] = (float)(s1base * real1[0] + s2base * real2[0]);
            Im[0] = (float)(s1base * imag1[0] + s2base * imag2[0]);
            int packed = real1.Length;
            for (int i = 1; i < packed; i++)
            {
                double mag1 = Abs(real1[i], imag1[i]);
                double mag2 = Abs(real2[i], imag2[i]);
                double dbMag1 = 20.0 * Math.Log10(mag1);
                double dbMag2 = 20.0 * Math.Log10(mag2);
                double s1 = s1base, s2 = s2base;
                double dbMagDiff = dbMag1 - dbMag2;
                // Blink's empirical tweak to keep higher-frequency zeroes.
                double threshold = i > 16 ? 5.0 : 2.0;
                if (dbMagDiff < -threshold && dbMag1 < 0.0)
                {
                    s1 = Math.Pow(s1, 0.75);
                    s2 = 1.0 - s1;
                }
                else if (dbMagDiff > threshold && dbMag2 < 0.0)
                {
                    s2 = Math.Pow(s2, 0.75);
                    s1 = 1.0 - s2;
                }
                double dbMag = s1 * dbMag1 + s2 * dbMag2;
                double mag = Math.Pow(10.0, 0.05 * dbMag);

                double phase1 = Math.Atan2(imag1[i], real1[i]);
                double phase2 = Math.Atan2(imag2[i], real2[i]);
                double deltaPhase1 = phase1 - lastPhase1;
                double deltaPhase2 = phase2 - lastPhase2;
                lastPhase1 = phase1;
                lastPhase2 = phase2;
                if (deltaPhase1 > Math.PI) deltaPhase1 -= 2 * Math.PI;
                if (deltaPhase1 < -Math.PI) deltaPhase1 += 2 * Math.PI;
                if (deltaPhase2 > Math.PI) deltaPhase2 -= 2 * Math.PI;
                if (deltaPhase2 < -Math.PI) deltaPhase2 += 2 * Math.PI;

                double deltaPhaseBlend;
                if (deltaPhase1 - deltaPhase2 > Math.PI) deltaPhaseBlend = s1 * deltaPhase1 + s2 * (2 * Math.PI + deltaPhase2);
                else if (deltaPhase2 - deltaPhase1 > Math.PI) deltaPhaseBlend = s1 * (2 * Math.PI + deltaPhase1) + s2 * deltaPhase2;
                else deltaPhaseBlend = s1 * deltaPhase1 + s2 * deltaPhase2;

                phaseAccum += deltaPhaseBlend;
                if (phaseAccum > Math.PI) phaseAccum -= 2 * Math.PI;
                if (phaseAccum < -Math.PI) phaseAccum += 2 * Math.PI;

                Re[i] = (float)(mag * Math.Cos(phaseAccum));
                Im[i] = (float)(mag * Math.Sin(phaseAccum));
            }
        }

        static double Abs(float re, float im) { return Math.Sqrt((double)re * re + (double)im * im); }

        /// <summary>
        /// FFTFrame::ExtractAverageGroupDelay: the response's leading delay,
        /// weighted by magnitude, taken out of the spectrum (less 20 frames of
        /// headroom) and returned in frames.
        /// </summary>
        public double ExtractAverageGroupDelay()
        {
            double aveSum = 0, weightSum = 0, lastPhase = 0;
            int packed = Re.Length;
            double samplePhaseDelay = 2 * Math.PI / Size;
            for (int i = 0; i < packed; i++)
            {
                double mag = Abs(Re[i], Im[i]);
                double phase = Math.Atan2(Im[i], Re[i]);
                double deltaPhase = phase - lastPhase;
                lastPhase = phase;
                if (deltaPhase < -Math.PI) deltaPhase += 2 * Math.PI;
                if (deltaPhase > Math.PI) deltaPhase -= 2 * Math.PI;
                aveSum += mag * deltaPhase;
                weightSum += mag;
            }
            double ave = aveSum / weightSum;
            double aveSampleDelay = -ave / samplePhaseDelay;
            if (aveSampleDelay > 20.0) aveSampleDelay -= 20.0;
            AddConstantGroupDelay(-aveSampleDelay);
            Re[0] = 0f;
            return aveSampleDelay;
        }

        void AddConstantGroupDelay(double sampleFrameDelay)
        {
            int packed = Re.Length;
            double samplePhaseDelay = 2 * Math.PI / Size;
            double phaseAdj = -sampleFrameDelay * samplePhaseDelay;
            for (int i = 1; i < packed; i++)
            {
                double mag = Abs(Re[i], Im[i]);
                double phase = Math.Atan2(Im[i], Re[i]);
                phase += i * phaseAdj;
                Re[i] = (float)(mag * Math.Cos(phase));
                Im[i] = (float)(mag * Math.Sin(phase));
            }
        }

        /// <summary>This spectrum times the kernel's, the packed DC and Nyquist terms each on their own.</summary>
        public void Multiply(HrtfFrame frame)
        {
            float[] r1 = Re, i1 = Im, r2 = frame.Re, i2 = frame.Im;
            float real0 = r1[0], imag0 = i1[0];
            for (int k = 0; k < r1.Length; k++)
            {
                float a = r1[k], b = i1[k], c = r2[k], d = i2[k];
                r1[k] = a * c - b * d;
                i1[k] = a * d + b * c;
            }
            r1[0] = real0 * r2[0];
            i1[0] = imag0 * i2[0];
        }
    }

    /// <summary>Blink's HRTFKernel: one ear's response as a spectrum, and its leading delay.</summary>
    sealed class HrtfKernel
    {
        public readonly HrtfFrame Frame;
        public readonly float FrameDelay;

        HrtfKernel(HrtfFrame frame, float frameDelay) { Frame = frame; FrameDelay = frameDelay; }

        public static HrtfKernel FromResponse(float[] response, int fftSize, float sampleRate, HrtfFft analysis, HrtfFft full)
        {
            // The leading delay (average group delay), taken out of the response.
            int analysisSize = fftSize / 2;
            var estimation = new HrtfFrame(analysisSize);
            estimation.DoFft(analysis, new ReadOnlySpan<float>(response, 0, analysisSize));
            float frameDelay = ClampToFloat(estimation.ExtractAverageGroupDelay());
            estimation.DoInverseFft(analysis, new Span<float>(response, 0, analysisSize));

            // Truncated to half the FFT size, with a quick fade at the cut.
            int truncated = Math.Min(response.Length, fftSize / 2);
            int fadeFrames = (int)(uint)(sampleRate / 4410);
            for (int i = truncated - fadeFrames; i < truncated; i++)
            {
                float x = 1.0f - (float)(i - (truncated - fadeFrames)) / fadeFrames;
                response[i] *= x;
            }
            var frame = new HrtfFrame(fftSize);
            frame.DoPaddedFft(full, new ReadOnlySpan<float>(response, 0, truncated));
            return new HrtfKernel(frame, frameDelay);
        }

        public static HrtfKernel Interpolated(HrtfKernel k1, HrtfKernel k2, float x, HrtfFft full)
        {
            x = Math.Clamp(x, 0f, 1f);
            float frameDelay = Lerp(k1.FrameDelay, k2.FrameDelay, x);
            return new HrtfKernel(HrtfFrame.Interpolated(k1.Frame, k2.Frame, x, full), frameDelay);
        }

        static float ClampToFloat(double v)
        {
            if (v >= float.MaxValue) return float.MaxValue;
            if (v <= float.MinValue) return float.MinValue;
            return (float)v;
        }

        // std::lerp for float, as libc++ writes it for the values in use here.
        static float Lerp(float a, float b, float t)
        {
            if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) return t * b + (1 - t) * a;
            if (t == 1) return b;
            float x = a + t * (b - a);
            return (t > 1) == (b > a) ? (b < x ? x : b) : (b > x ? x : b);
        }
    }

    /// <summary>
    /// Chromium's media::SincResampler, for the one use the HRTF data has of
    /// it: a whole response at once, read in requests of 64 frames, which
    /// picks its 32 tap kernel (AudioBus::TryCreateBySampleRateConverting).
    /// Convolve_C's order of sums.
    /// </summary>
    static class HrtfResample
    {
        const int KernelSize = 32;
        const int KernelOffsetCount = 32;
        const int RequestFrames = 64;

        public static float[] Resample(float[] source, double sourceRate, double destinationRate)
        {
            double ratio = sourceRate / destinationRate;
            int destinationLength = (int)(source.Length / ratio);
            var dest = new float[destinationLength];

            // InitializeKernel, with SincScaleFactor for the 32 tap kernel.
            double scale = (ratio > 1.0 ? 1.0 / ratio : 1.0) * 0.90;
            const double kAlpha = 0.16, kA0 = 0.5 * (1.0 - kAlpha), kA1 = 0.5, kA2 = 0.5 * kAlpha;
            var kernel = new float[KernelSize * (KernelOffsetCount + 1)];
            for (int offsetIdx = 0; offsetIdx <= KernelOffsetCount; offsetIdx++)
            {
                float subsampleOffset = (float)offsetIdx / KernelOffsetCount;
                for (int i = 0; i < KernelSize; i++)
                {
                    int idx = i + offsetIdx * KernelSize;
                    float preSinc = (float)Math.PI * (i - KernelSize / 2 - subsampleOffset);
                    float x = (i - subsampleOffset) / KernelSize;
                    float window = (float)(kA0 - kA1 * Math.Cos(2.0 * Math.PI * x) + kA2 * Math.Cos(4.0 * Math.PI * x));
                    kernel[idx] = (float)(window * (preSinc != 0 ? Math.Sin(scale * preSinc) / preSinc : scale));
                }
            }

            // The buffer and its regions, by index: r1 at 0, r2 at half a kernel.
            var input = new float[RequestFrames + KernelSize];
            const int r1 = 0, r2 = KernelSize / 2;
            int r0 = KernelSize / 2, r3, blockSize;
            Regions(r0, out r3, out blockSize);
            int read = 0;
            void ReadInto(float[] buffer, int at)
            {
                int n = Math.Max(0, Math.Min(RequestFrames, source.Length - read));
                Array.Copy(source, read, buffer, at, n);
                Array.Clear(buffer, at + n, RequestFrames - n);
                read += n;
            }

            double virtualSourceIdx = 0;
            int remaining = dest.Length, d = 0;
            if (remaining > 0) ReadInto(input, r0);
            while (remaining > 0)
            {
                while (virtualSourceIdx < blockSize)
                {
                    int sourceIdx = (int)virtualSourceIdx;
                    double virtualOffsetIdx = (virtualSourceIdx - sourceIdx) * KernelOffsetCount;
                    int offsetIdx = (int)virtualOffsetIdx;
                    int k1 = offsetIdx * KernelSize, k2 = k1 + KernelSize;
                    float sum1 = 0, sum2 = 0;
                    for (int i = 0; i < KernelSize; i++)
                    {
                        float v = input[r1 + sourceIdx + i];
                        sum1 += v * kernel[k1 + i];
                        sum2 += v * kernel[k2 + i];
                    }
                    double f = virtualOffsetIdx - offsetIdx;
                    dest[d++] = (float)((1.0 - f) * sum1 + f * sum2);
                    virtualSourceIdx += ratio;
                    if (--remaining == 0) return dest;
                }
                virtualSourceIdx -= blockSize;
                Array.Copy(input, r3, input, r1, KernelSize);
                if (r0 == r2)
                {
                    r0 = KernelSize;
                    Regions(r0, out r3, out blockSize);
                }
                ReadInto(input, r0);
            }
            return dest;
        }

        static void Regions(int r0, out int r3, out int blockSize)
        {
            r3 = r0 + RequestFrames - KernelSize;
            int r4 = r0 + RequestFrames - KernelSize / 2;
            blockSize = r4 - KernelSize / 2;
        }
    }

    /// <summary>
    /// Blink's HRTFDatabase with its HRTFElevations, at the mix's 48 kHz:
    /// ten elevations from -45 to 90 degrees, each with 192 azimuths (the 24
    /// measured, 15 degrees apart, and seven interpolated between each pair).
    /// Built once, off the audio thread, the first time a mix asks for it.
    /// </summary>
    sealed class HrtfDatabase
    {
        public const int RawAzimuths = 24;
        const int AzimuthSpacing = 15;
        const int InterpolationFactor = 8;
        public const int Azimuths = RawAzimuths * InterpolationFactor;
        const int Responses = 240;
        const int ResponseFrames = 256;
        const float ResponseRate = 44100;
        const int MinElevation = -45, MaxElevation = 90, ElevationSpacing = 15;
        public const int Elevations = 1 + (MaxElevation - MinElevation) / ElevationSpacing;

        // The order of the elevations in each azimuth's run of the file.
        static readonly int[] ElevationIndexTable = { 0, 15, 30, 45, 60, 75, 90, 315, 330, 345 };
        // The IRCAM responses go no higher than this at each azimuth.
        static readonly int[] MaxElevations =
        {
            90, 45, 60, 45, 75, 45, 60, 45, 75, 45, 60, 45,
            75, 45, 60, 45, 75, 45, 60, 45, 75, 45, 60, 45,
        };

        public readonly float SampleRate;
        public readonly int FftSize;
        readonly HrtfKernel[][] left, right;   // [elevation][azimuth]

        static Task<HrtfDatabase> shared;
        static readonly object sharedGate = new object();

        /// <summary>
        /// The database for the mix's rate, started on the thread pool the first
        /// time it is asked for. Until it is built a panner passes the voice to
        /// both ears unfiltered, as Blink's does while its loader works.
        /// </summary>
        public static Task<HrtfDatabase> Shared()
        {
            lock (sharedGate)
            {
                if (shared == null) shared = Task.Run(delegate { return new HrtfDatabase(VoiceMix.Rate); });
                return shared;
            }
        }

        public HrtfDatabase(float sampleRate)
        {
            SampleRate = sampleRate;
            FftSize = FftSizeForSampleRate(sampleRate);
            float[] l, r;
            ReadComposite(out l, out r);
            var analysis = new HrtfFft(FftSize / 2);
            var full = new HrtfFft(FftSize);
            left = new HrtfKernel[Elevations][];
            right = new HrtfKernel[Elevations][];
            int e = 0;
            for (int elevation = MinElevation; elevation <= MaxElevation; elevation += ElevationSpacing, e++)
            {
                left[e] = new HrtfKernel[Azimuths];
                right[e] = new HrtfKernel[Azimuths];
                for (int raw = 0; raw < RawAzimuths; raw++)
                {
                    int actual = Math.Min(elevation, MaxElevations[raw]);
                    int positive = actual < 0 ? actual + 360 : actual;
                    int elevationIndex = Array.IndexOf(ElevationIndexTable, positive);
                    int index = raw * ElevationIndexTable.Length + elevationIndex;
                    int start = index * ResponseFrames;
                    float[] rl = HrtfResample.Resample(l.AsSpan(start, ResponseFrames).ToArray(), ResponseRate, sampleRate);
                    float[] rr = HrtfResample.Resample(r.AsSpan(start, ResponseFrames).ToArray(), ResponseRate, sampleRate);
                    if (2 * rl.Length < FftSize) { Array.Resize(ref rl, FftSize / 2); Array.Resize(ref rr, FftSize / 2); }
                    left[e][raw * InterpolationFactor] = HrtfKernel.FromResponse(rl, FftSize, sampleRate, analysis, full);
                    right[e][raw * InterpolationFactor] = HrtfKernel.FromResponse(rr, FftSize, sampleRate, analysis, full);
                }
                for (int i = 0; i < Azimuths; i += InterpolationFactor)
                {
                    int j = (i + InterpolationFactor) % Azimuths;
                    for (int jj = 1; jj < InterpolationFactor; jj++)
                    {
                        float x = (float)jj / InterpolationFactor;
                        left[e][i + jj] = HrtfKernel.Interpolated(left[e][i], left[e][j], x, full);
                        right[e][i + jj] = HrtfKernel.Interpolated(right[e][i], right[e][j], x, full);
                    }
                }
            }
        }

        /// <summary>
        /// The 240 responses, in the file's order (each azimuth from 0 to 345 in
        /// steps of 15, and within it the elevations of ElevationIndexTable), as
        /// floats the way Chromium's decoder makes them from 16-bit samples
        /// (media's SignedInt16SampleTypeTraits): negative values times
        /// 1/32768 and positive times 1/32767.
        /// </summary>
        static void ReadComposite(out float[] l, out float[] r)
        {
            byte[] wav;
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("hrtf-composite.wav"))
            {
                if (s == null) throw new InvalidDataException("the launcher was built without hrtf-composite.wav");
                var ms = new MemoryStream();
                s.CopyTo(ms);
                wav = ms.ToArray();
            }
            int frames = Responses * ResponseFrames;
            int data = -1;
            for (int at = 12; at + 8 <= wav.Length;)
            {
                int size = BitConverter.ToInt32(wav, at + 4);
                if (wav[at] == 'd' && wav[at + 1] == 'a' && wav[at + 2] == 't' && wav[at + 3] == 'a') { data = at + 8; break; }
                at += 8 + size + (size & 1);
            }
            if (data < 0 || data + frames * 4 > wav.Length)
                throw new InvalidDataException("hrtf-composite.wav does not hold " + frames + " stereo 16-bit frames");
            l = new float[frames];
            r = new float[frames];
            for (int i = 0; i < frames; i++)
            {
                l[i] = ToFloat(BitConverter.ToInt16(wav, data + 4 * i));
                r[i] = ToFloat(BitConverter.ToInt16(wav, data + 4 * i + 2));
            }
        }

        static float ToFloat(short v) { float f = v; return f < 0f ? f * (1.0f / 32768f) : f * (1.0f / 32767f); }

        /// <summary>HRTFPanner::FftSizeForSampleRate: 512 at 44.1 and 48 kHz.</summary>
        public static int FftSizeForSampleRate(float sampleRate)
        {
            const int truncatedImpulseLength = 256;
            double ratio = sampleRate / 44100;
            double resampledLength = truncatedImpulseLength * ratio;
            int analysis = 1 << (int)(uint)Math.Log2(resampledLength);
            analysis = Math.Max(analysis, 2);
            return 2 * analysis;
        }

        /// <summary>
        /// HRTFDatabase::GetKernelsFromAzimuthElevation and
        /// HRTFElevation::GetKernelsFromAzimuth: the kernels at the azimuth
        /// index, and the delays blended with the next azimuth's.
        /// </summary>
        public void Kernels(double azimuthBlend, int azimuthIndex, double elevation,
                            out HrtfKernel kl, out HrtfKernel kr, out double delayL, out double delayR)
        {
            elevation = Math.Clamp(elevation, MinElevation, MaxElevation);
            int e = (int)((elevation - MinElevation) / ElevationSpacing);
            if (e > Elevations - 1) e = Elevations - 1;
            kl = left[e][azimuthIndex];
            kr = right[e][azimuthIndex];
            int next = (azimuthIndex + 1) % Azimuths;
            delayL = Lerp(kl.FrameDelay, left[e][next].FrameDelay, azimuthBlend);
            delayR = Lerp(kr.FrameDelay, right[e][next].FrameDelay, azimuthBlend);
        }

        // std::lerp for double, as libc++ writes it.
        public static double Lerp(double a, double b, double t)
        {
            if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) return t * b + (1 - t) * a;
            if (t == 1) return b;
            double x = a + t * (b - a);
            return (t > 1) == (b > a) ? (b < x ? x : b) : (b > x ? x : b);
        }
    }

    /// <summary>
    /// Blink's FFTConvolver: overlap-add, a block of half the FFT size at a
    /// time, so its output trails its input by that half.
    /// </summary>
    sealed class HrtfConvolver
    {
        readonly HrtfFft fft;
        readonly HrtfFrame frame;
        readonly float[] input, output, lastOverlap;
        readonly int half;
        int readWrite;

        public HrtfConvolver(int fftSize)
        {
            fft = new HrtfFft(fftSize);
            frame = new HrtfFrame(fftSize);
            input = new float[fftSize];
            output = new float[fftSize];
            lastOverlap = new float[fftSize / 2];
            half = fftSize / 2;
        }

        public void Process(HrtfFrame kernel, ReadOnlySpan<float> source, Span<float> dest)
        {
            while (!source.IsEmpty)
            {
                int n = Math.Min(source.Length, half - readWrite);
                source.Slice(0, n).CopyTo(new Span<float>(input, readWrite, n));
                source = source.Slice(n);
                new ReadOnlySpan<float>(output, readWrite, n).CopyTo(dest);
                dest = dest.Slice(n);
                readWrite += n;
                if (readWrite == half)
                {
                    frame.DoFft(fft, input);
                    frame.Multiply(kernel);
                    frame.DoInverseFft(fft, output);
                    for (int i = 0; i < half; i++) output[i] += lastOverlap[i];
                    Array.Copy(output, half, lastOverlap, 0, half);
                    readWrite = 0;
                }
            }
        }

        /// <summary>
        /// What Process would leave after this many frames of silence, once
        /// enough silence has gone through that every buffer holds zeros
        /// (Silent says when): only where the next block starts moves.
        /// </summary>
        public void SkipSilence(int frames) { readWrite = (readWrite + frames) % half; }

        /// <summary>
        /// Frames of silence in a row after which every buffer is zeros: the
        /// rest of the block the last sound was in, the block that carries its
        /// overlap out, and the one after.
        /// </summary>
        public int Silent { get { return half - 1 + 2 * half; } }
    }

    /// <summary>Blink's Delay, k-rate: one delay for a whole render quantum, with linear interpolation.</summary>
    sealed class HrtfDelay
    {
        readonly float[] buffer, temp;
        readonly float sampleRate;
        readonly double maxDelayTime;
        int writeIndex;
        double desiredDelayFrames;

        public HrtfDelay(double maxDelayTime, float sampleRate, int quantum)
        {
            this.maxDelayTime = maxDelayTime;
            this.sampleRate = sampleRate;
            // TimeToSampleFrame with kRoundUp, oversampled by 1024 as Blink does.
            double frame = Math.Round(maxDelayTime * sampleRate * 1024) / 1024;
            buffer = new float[quantum + (int)Math.Ceiling(frame)];
            temp = new float[quantum];
        }

        public int Length { get { return buffer.Length; } }

        public void SetDelayFrames(double frames) { desiredDelayFrames = frames; }

        public void ProcessKRate(ReadOnlySpan<float> source, Span<float> destination, int frames)
        {
            int len = buffer.Length;
            double delayTime = desiredDelayFrames / sampleRate;
            delayTime = Math.Clamp(delayTime, 0.0, maxDelayTime);
            double desired = delayTime * sampleRate;
            int w = writeIndex;
            double readPosition = w + len - desired;
            if (readPosition >= len) readPosition -= len;
            int readIndex1 = (int)readPosition;
            float f = (float)(readPosition - readIndex1);

            // Into the circular buffer at the write index.
            int remainder = len - w;
            int first = Math.Min(frames, remainder);
            source.Slice(0, first).CopyTo(new Span<float>(buffer, w, first));
            if (frames > remainder) source.Slice(remainder, frames - remainder).CopyTo(buffer);
            w += frames;
            if (w >= len) w -= len;
            writeIndex = w;

            // Out of it from the read position.
            remainder = len - readIndex1;
            first = Math.Min(frames, remainder);
            new ReadOnlySpan<float>(buffer, readIndex1, first).CopyTo(destination);
            if (frames > remainder) new ReadOnlySpan<float>(buffer, 0, frames - remainder).CopyTo(destination.Slice(remainder));

            if (f != 0)
            {
                int readIndex2 = (readIndex1 + 1) % len;
                remainder = len - readIndex2;
                first = Math.Min(frames, remainder);
                Array.Copy(buffer, readIndex2, temp, 0, first);
                if (frames > remainder) Array.Copy(buffer, 0, temp, remainder, frames - remainder);
                for (int k = 0; k < frames; k++) temp[k] = temp[k] - destination[k];
                for (int k = 0; k < frames; k++) destination[k] += f * temp[k];
            }
        }

        /// <summary>What ProcessKRate does to the state for silence once the buffer holds only zeros.</summary>
        public void SkipSilence(int frames) { writeIndex = (writeIndex + frames) % buffer.Length; }
    }

    /// <summary>
    /// Blink's HRTFPanner for one voice: the delay lines for the time between
    /// the ears, two pairs of convolvers, and a crossfade of about 43 ms
    /// between them whenever the voice moves to another kernel.
    /// </summary>
    sealed class HrtfPanner
    {
        public const int Quantum = 128;
        const double MaxDelayTimeSeconds = 0.002;
        const int Uninitialized = -1;

        readonly Task<HrtfDatabase> loader;
        readonly float sampleRate;
        readonly HrtfConvolver l1, r1, l2, r2;
        readonly HrtfDelay delayL, delayR;
        readonly float[] tl1 = new float[Quantum], tr1 = new float[Quantum], tl2 = new float[Quantum], tr2 = new float[Quantum];
        readonly float[] delayed = new float[Quantum];

        bool selection2;
        int azimuthIndex1 = Uninitialized, azimuthIndex2 = Uninitialized;
        double elevation1, elevation2;
        float crossfadeX, crossfadeIncr;

        // Frames of silence in a row into the delay lines, and into each pair
        // of convolvers, so a quantum of silence that would leave every
        // buffer as it is (all zeros) is skipped rather than worked out.
        long quietIn, quiet1, quiet2;

        public HrtfPanner(Task<HrtfDatabase> loader, float sampleRate)
        {
            this.loader = loader;
            this.sampleRate = sampleRate;
            int fftSize = HrtfDatabase.FftSizeForSampleRate(sampleRate);
            l1 = new HrtfConvolver(fftSize); r1 = new HrtfConvolver(fftSize);
            l2 = new HrtfConvolver(fftSize); r2 = new HrtfConvolver(fftSize);
            delayL = new HrtfDelay(MaxDelayTimeSeconds, sampleRate, Quantum);
            delayR = new HrtfDelay(MaxDelayTimeSeconds, sampleRate, Quantum);
        }

        /// <summary>
        /// One render quantum of a mono voice into both ears. The azimuth and
        /// elevation are the PannerNode's (Azimuth below), in degrees.
        /// </summary>
        public void Pan(double desiredAzimuth, double elevation, ReadOnlySpan<float> source, Span<float> left, Span<float> right)
        {
            Task<HrtfDatabase> t = loader;
            HrtfDatabase database = t.IsCompletedSuccessfully ? t.Result : null;
            if (database == null)
            {
                source.CopyTo(left);
                source.CopyTo(right);
                return;
            }
            int frames = source.Length;

            // The IRCAM azimuths run the other way round from the panner's.
            double azimuth = -desiredAzimuth;
            if (azimuth < 0) azimuth += 360.0;
            double between = 360.0 / HrtfDatabase.Azimuths;
            double indexFloat = azimuth / between;
            int desiredIndex = (int)indexFloat;
            double azimuthBlend = indexFloat - desiredIndex;
            desiredIndex = Math.Clamp(desiredIndex, 0, HrtfDatabase.Azimuths - 1);

            if (azimuthIndex1 == Uninitialized) { azimuthIndex1 = desiredIndex; elevation1 = elevation; }
            if (azimuthIndex2 == Uninitialized) { azimuthIndex2 = desiredIndex; elevation2 = elevation; }

            double fadeFrames = sampleRate <= 48000 ? 2048 : 4096;
            if (crossfadeX == 0 && !selection2)
            {
                if (desiredIndex != azimuthIndex1 || elevation != elevation1)
                {
                    crossfadeIncr = (float)(1 / fadeFrames);
                    azimuthIndex2 = desiredIndex;
                    elevation2 = elevation;
                }
            }
            if (crossfadeX == 1 && selection2)
            {
                if (desiredIndex != azimuthIndex2 || elevation != elevation2)
                {
                    crossfadeIncr = (float)(-1 / fadeFrames);
                    azimuthIndex1 = desiredIndex;
                    elevation1 = elevation;
                }
            }

            bool crossfading = crossfadeIncr != 0;
            bool use1 = !selection2 || crossfading, use2 = selection2 || crossfading;

            bool silentIn = AllZero(source);
            if (silentIn && quietIn >= delayL.Length &&
                (!use1 || quiet1 >= l1.Silent) && (!use2 || quiet2 >= l2.Silent))
            {
                // Silence into buffers that hold nothing else: zeros out, and
                // every index moves on as Process would have moved it.
                delayL.SkipSilence(frames); delayR.SkipSilence(frames);
                if (use1) { l1.SkipSilence(frames); r1.SkipSilence(frames); quiet1 += frames; }
                if (use2) { l2.SkipSilence(frames); r2.SkipSilence(frames); quiet2 += frames; }
                quietIn += frames;
                left.Slice(0, frames).Clear();
                right.Slice(0, frames).Clear();
                if (crossfading) AdvanceCrossfade(frames);
                return;
            }

            HrtfKernel kl1, kr1, kl2, kr2;
            double dl1, dr1, dl2, dr2;
            database.Kernels(azimuthBlend, azimuthIndex1, elevation1, out kl1, out kr1, out dl1, out dr1);
            database.Kernels(azimuthBlend, azimuthIndex2, elevation2, out kl2, out kr2, out dl2, out dr2);
            double frameDelayL = HrtfDatabase.Lerp(dl1, dl2, crossfadeX);
            double frameDelayR = HrtfDatabase.Lerp(dr1, dr2, crossfadeX);

            delayL.SetDelayFrames(frameDelayL);
            delayR.SetDelayFrames(frameDelayR);
            delayL.ProcessKRate(source, left, frames);
            delayR.ProcessKRate(source, right, frames);
            quietIn = silentIn ? quietIn + frames : 0;
            // Both ears are fed the same voice, so one ear's delayed
            // silence says the other's is too only once both delays are
            // past it; the left ear's convolvers and the right's are counted
            // together, by both outputs.
            bool silentDelayed = AllZero(left.Slice(0, frames)) && AllZero(right.Slice(0, frames));

            Span<float> dl1s = crossfading ? tl1 : left, dr1s = crossfading ? tr1 : right;
            Span<float> dl2s = crossfading ? tl2 : left, dr2s = crossfading ? tr2 : right;
            if (use1)
            {
                l1.Process(kl1.Frame, left.Slice(0, frames), dl1s.Slice(0, frames));
                r1.Process(kr1.Frame, right.Slice(0, frames), dr1s.Slice(0, frames));
                quiet1 = silentDelayed ? quiet1 + frames : 0;
            }
            if (use2)
            {
                l2.Process(kl2.Frame, left.Slice(0, frames), dl2s.Slice(0, frames));
                r2.Process(kr2.Frame, right.Slice(0, frames), dr2s.Slice(0, frames));
                quiet2 = silentDelayed ? quiet2 + frames : 0;
            }
            if (crossfading)
            {
                float x = crossfadeX, incr = crossfadeIncr;
                for (int i = 0; i < frames; i++)
                {
                    left[i] = (1 - x) * tl1[i] + x * tl2[i];
                    right[i] = (1 - x) * tr1[i] + x * tr2[i];
                    x += incr;
                }
                crossfadeX = x;
                EndCrossfade();
            }
        }

        void AdvanceCrossfade(int frames)
        {
            float x = crossfadeX, incr = crossfadeIncr;
            for (int i = 0; i < frames; i++) x += incr;
            crossfadeX = x;
            EndCrossfade();
        }

        void EndCrossfade()
        {
            if (crossfadeIncr > 0 && Math.Abs(crossfadeX - 1) < crossfadeIncr)
            {
                selection2 = true;
                crossfadeX = 1;
                crossfadeIncr = 0;
            }
            else if (crossfadeIncr < 0 && Math.Abs(crossfadeX) < -crossfadeIncr)
            {
                selection2 = false;
                crossfadeX = 0;
                crossfadeIncr = 0;
            }
        }

        static bool AllZero(ReadOnlySpan<float> s)
        {
            for (int i = 0; i < s.Length; i++) if (s[i] != 0) return false;
            return true;
        }

        /// <summary>
        /// PannerHandler::CalculateAzimuthElevation for Web Audio's default
        /// listener (at the origin, facing -z, +y up), with gfx's float
        /// vectors: the voice at x to the right, y up and z behind.
        /// </summary>
        public static void Azimuth(float x, float y, float z, out double azimuth, out double elevation)
        {
            double ls = (double)x * x + (double)y * y + (double)z * z;
            if (ls < 1e-12) { azimuth = 0; elevation = 0; return; }
            float n = (float)Math.Sqrt(ls);
            float sx = x / n, sy = y / n, sz = z / n;

            // right = (1, 0, 0), up = (0, 1, 0), forward = (0, 0, -1).
            float upProjection = sx * 0f + sy * 1f + sz * 0f;
            float px = sx - 0f * upProjection, py = sy - 1f * upProjection, pz = sz - 0f * upProjection;
            double pls = (double)px * px + (double)py * py + (double)pz * pz;
            if (pls >= 1e-12)
            {
                float pn = (float)Math.Sqrt(pls);
                px /= pn; py /= pn; pz /= pn;
            }
            // acos and base::RadToDeg of a float are floats.
            float dotRight = px * 1f + py * 0f + pz * 0f;
            azimuth = MathF.Acos(Math.Clamp(dotRight, -1.0f, 1.0f)) * 180 / MathF.PI;
            if (double.IsNaN(azimuth) || double.IsInfinity(azimuth)) azimuth = 0;
            float frontBack = px * 0f + py * 0f + pz * -1f;
            if (frontBack < 0.0) azimuth = 360.0 - azimuth;
            if (azimuth >= 0.0 && azimuth <= 270.0) azimuth = 90.0 - azimuth;
            else azimuth = 450.0 - azimuth;

            // AngleBetweenVectorsInDegrees(source, up), in float as gfx has it.
            float sLen = (float)Math.Sqrt((double)sx * sx + (double)sy * sy + (double)sz * sz);
            float cos = Math.Max(Math.Min((sx * 0f + sy * 1f + sz * 0f) / sLen / 1f, 1f), -1f);
            float angle = MathF.Acos(cos) * 180 / MathF.PI;
            elevation = 90 - angle;
            if (double.IsNaN(elevation) || double.IsInfinity(elevation)) elevation = 0;
            if (elevation > 90.0) elevation = 180.0 - elevation;
            else if (elevation < -90.0) elevation = -180.0 - elevation;
        }
    }
}
