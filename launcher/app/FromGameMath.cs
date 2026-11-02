using System;

namespace Thornswood
{
    /// <summary>
    /// The arithmetic scripts\mods\Build-NoticeBoard.py does with numpy, done
    /// the way numpy did it, so the notice board and drop box FromGame builds
    /// are the same bytes as the meshes that shipped (#2827).
    ///
    /// Two things decide the last bit of a number there, and both are kept:
    /// - numpy hands a matrix product to OpenBLAS, which fuses each multiply
    ///   into the running sum (one rounding, not two), in an order of its own:
    ///   a row times a matrix (gemm) is fma(a2, b2, fma(a1, b1, a0 * b0)), and a
    ///   matrix times a vector (gemv) is fma(a2, b2, fma(a0, b0, a1 * b1)).
    ///   Measured 19 Oct on numpy 2.5 with OpenBLAS 0.3.34 (Haswell kernels):
    ///   every one of 160,000 products matched these, and no unfused or other
    ///   order did. Fma below computes it exactly with integers, written
    ///   while the launcher ran on the .NET Framework, which has no fused
    ///   multiply-add. .NET 10 (#4823) has Math.FusedMultiplyAdd; nothing here
    ///   was moved to it.
    /// - numpy's sum along a row of three adds left to right, and a norm is
    ///   the square root of that sum of squares.
    /// - numpy's inv() is OpenBLAS's dgesv; Inverse below follows it step for
    ///   step. Measured 19 Oct the same way: 120,000 matrices, every bit the
    ///   same, signs of zeros included.
    /// - sin and cos are not done here at all: each part's rotation matrix is
    ///   in the recipe, as the numbers numpy made, because two maths
    ///   libraries can round a sine differently.
    /// A float32 or a byte is only different when a sum lands within one
    /// rounding of the line between two values, so where these matter is rare,
    /// but the meshes are compared byte for byte, so rare is not good enough.
    /// </summary>
    public static class FromGameMath
    {
        /// <summary>a * b + c with one rounding, as the processor's fused multiply-add gives it.</summary>
        public static double Fma(double a, double b, double c)
        {
            if (a == 0 || b == 0 || c == 0 || double.IsNaN(a) || double.IsNaN(b) || double.IsNaN(c) ||
                double.IsInfinity(a) || double.IsInfinity(b) || double.IsInfinity(c))
                return a * b + c; // the product is exact here, or the answer is not a number
            ulong ma, mb, mc;
            int ea, eb, ec;
            bool sa = Split(a, out ma, out ea), sb = Split(b, out mb, out eb), sc = Split(c, out mc, out ec);
            var p = Big.Product(ma, mb);
            int ep = ea + eb;
            bool sp = sa ^ sb;
            var q = Big.Of(mc);
            int topP = ep + p.BitLength(), topC = ec + q.BitLength();
            // A term far below the other only says which way to round: it is
            // put where it cannot reach a rounding line, keeping its sign.
            if (topP - topC > 120) { q = Big.Of(1); ec = topP - 100; }
            else if (topC - topP > 120) { p = Big.Of(1); ep = topC - 100; }
            int emin = Math.Min(ep, ec);
            p.ShiftLeft(ep - emin);
            q.ShiftLeft(ec - emin);
            Big m;
            bool neg;
            if (sp == sc) { m = Big.Add(p, q); neg = sp; }
            else
            {
                int cmp = Big.Compare(p, q);
                if (cmp == 0) return 0.0;
                if (cmp > 0) { m = Big.Sub(p, q); neg = sp; }
                else { m = Big.Sub(q, p); neg = sc; }
            }
            int t = m.BitLength() - 1;
            ulong mant;
            int exp = emin;
            if (t <= 52) mant = m.Low64();
            else
            {
                int shift = t - 52;
                bool guard = m.Bit(shift - 1), sticky = m.AnyBelow(shift - 1);
                m.ShiftRight(shift);
                mant = m.Low64();
                if (guard && (sticky || (mant & 1) != 0)) mant++;
                if (mant == (1UL << 53)) { mant >>= 1; shift++; }
                exp += shift;
            }
            double r = Scale((double)mant, exp);
            return neg ? -r : r;
        }

        static bool Split(double x, out ulong m, out int e)
        {
            long bits = BitConverter.DoubleToInt64Bits(x);
            int be = (int)((bits >> 52) & 0x7FF);
            ulong f = (ulong)bits & ((1UL << 52) - 1);
            if (be == 0) { m = f; e = -1074; }
            else { m = f | (1UL << 52); e = be - 1075; }
            return bits < 0;
        }

        static double Scale(double x, int n)
        {
            while (n > 1000) { x *= Pow2(1000); n -= 1000; }
            while (n < -1000) { x *= Pow2(-1000); n += 1000; }
            return x * Pow2(n);
        }

        static double Pow2(int n) { return BitConverter.Int64BitsToDouble((long)(n + 1023) << 52); }

        /// <summary>A whole number of up to 448 bits, for Fma's exact sum.</summary>
        sealed class Big
        {
            const int Limbs = 14;
            readonly uint[] w = new uint[Limbs];

            public static Big Of(ulong v) { var b = new Big(); b.w[0] = (uint)v; b.w[1] = (uint)(v >> 32); return b; }

            public static Big Product(ulong a, ulong b)
            {
                var r = new Big();
                uint[] x = { (uint)a, (uint)(a >> 32) }, y = { (uint)b, (uint)(b >> 32) };
                for (int i = 0; i < 2; i++)
                {
                    ulong carry = 0;
                    for (int j = 0; j < 2; j++)
                    {
                        ulong t = (ulong)x[i] * y[j] + r.w[i + j] + carry;
                        r.w[i + j] = (uint)t;
                        carry = t >> 32;
                    }
                    r.w[i + 2] += (uint)carry;
                }
                return r;
            }

            public int BitLength()
            {
                for (int i = Limbs - 1; i >= 0; i--)
                    if (w[i] != 0)
                    {
                        int n = 0;
                        uint v = w[i];
                        while (v != 0) { n++; v >>= 1; }
                        return i * 32 + n;
                    }
                return 0;
            }

            public void ShiftLeft(int n)
            {
                if (n <= 0) return;
                int limbs = n / 32, bits = n % 32;
                for (int i = Limbs - 1; i >= 0; i--)
                {
                    int s = i - limbs;
                    uint hi = s >= 0 ? w[s] : 0, lo = s - 1 >= 0 ? w[s - 1] : 0;
                    w[i] = bits == 0 ? hi : (hi << bits) | (lo >> (32 - bits));
                }
            }

            public void ShiftRight(int n)
            {
                if (n <= 0) return;
                int limbs = n / 32, bits = n % 32;
                for (int i = 0; i < Limbs; i++)
                {
                    int s = i + limbs;
                    uint lo = s < Limbs ? w[s] : 0, hi = s + 1 < Limbs ? w[s + 1] : 0;
                    w[i] = bits == 0 ? lo : (lo >> bits) | (hi << (32 - bits));
                }
            }

            public bool Bit(int n) { return n >= 0 && ((w[n / 32] >> (n % 32)) & 1) != 0; }

            public bool AnyBelow(int n)
            {
                for (int i = 0; i < n; i++) if (Bit(i)) return true;
                return false;
            }

            public ulong Low64() { return w[0] | ((ulong)w[1] << 32); }

            public static int Compare(Big a, Big b)
            {
                for (int i = Limbs - 1; i >= 0; i--)
                    if (a.w[i] != b.w[i]) return a.w[i] < b.w[i] ? -1 : 1;
                return 0;
            }

            public static Big Add(Big a, Big b)
            {
                var r = new Big();
                ulong carry = 0;
                for (int i = 0; i < Limbs; i++)
                {
                    ulong t = (ulong)a.w[i] + b.w[i] + carry;
                    r.w[i] = (uint)t;
                    carry = t >> 32;
                }
                return r;
            }

            public static Big Sub(Big a, Big b)
            {
                var r = new Big();
                long borrow = 0;
                for (int i = 0; i < Limbs; i++)
                {
                    long t = (long)a.w[i] - b.w[i] - borrow;
                    borrow = t < 0 ? 1 : 0;
                    r.w[i] = (uint)(t + (borrow << 32));
                }
                return r;
            }
        }

        /// <summary>One entry of a row times a matrix, as OpenBLAS's gemm sums it.</summary>
        public static double Gemm(double a0, double b0, double a1, double b1, double a2, double b2)
        {
            // The sum starts from a zeroed register and lands in a zeroed
            // result, so a sum that is exactly zero is +0, never -0.
            return Fma(a2, b2, Fma(a1, b1, Fma(a0, b0, 0.0))) + 0.0;
        }

        /// <summary>One entry of a matrix times a vector, as OpenBLAS's gemv sums it.</summary>
        public static double Gemv(double a0, double b0, double a1, double b1, double a2, double b2)
        {
            return Fma(a2, b2, Fma(a0, b0, Fma(a1, b1, 0.0))) + 0.0;
        }

        /// <summary>a @ b for two 3 by 3 matrices (row major).</summary>
        public static double[] MatMul(double[] a, double[] b)
        {
            var r = new double[9];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                    r[i * 3 + j] = Gemm(a[i * 3], b[j], a[i * 3 + 1], b[3 + j], a[i * 3 + 2], b[6 + j]);
            return r;
        }

        /// <summary>a @ b.T for two 3 by 3 matrices.</summary>
        public static double[] MatMulT(double[] a, double[] b)
        {
            var r = new double[9];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                    r[i * 3 + j] = Gemm(a[i * 3], b[j * 3], a[i * 3 + 1], b[j * 3 + 1], a[i * 3 + 2], b[j * 3 + 2]);
            return r;
        }

        /// <summary>a @ v for a 3 by 3 matrix and a vector.</summary>
        public static double[] MatVec(double[] a, double[] v)
        {
            var r = new double[3];
            for (int i = 0; i < 3; i++) r[i] = Gemv(a[i * 3], v[0], a[i * 3 + 1], v[1], a[i * 3 + 2], v[2]);
            return r;
        }

        /// <summary>The row v times a.T, one row of numpy's (n, 3) @ a.T.</summary>
        public static void RowT(double x, double y, double z, double[] a, double[] r)
        {
            r[0] = Gemm(x, a[0], y, a[1], z, a[2]);
            r[1] = Gemm(x, a[3], y, a[4], z, a[5]);
            r[2] = Gemm(x, a[6], y, a[7], z, a[8]);
        }

        /// <summary>The row v times a, one row of numpy's (n, 3) @ a.</summary>
        public static void Row(double x, double y, double z, double[] a, double[] r)
        {
            r[0] = Gemm(x, a[0], y, a[3], z, a[6]);
            r[1] = Gemm(x, a[1], y, a[4], z, a[7]);
            r[2] = Gemm(x, a[2], y, a[5], z, a[8]);
        }

        /// <summary>
        /// numpy's inv() of a 3 by 3 matrix, step for step as OpenBLAS does it
        /// (LAPACK dgesv on the identity): its getf2 LU with partial pivoting
        /// (column by column, multiplying by the pivot's reciprocal), then its
        /// two triangular solves, which multiply by the reciprocal of each
        /// diagonal entry. Where OpenBLAS's kernels fuse a multiply into a sum,
        /// so does this, and a sum OpenBLAS starts from +0 starts from +0 here
        /// (which decides the sign of a zero). It turns normals, and a normal lying along an axis
        /// lands on the line between two bytes, where the sign of the last bit
        /// decides the byte, so the inverse has to be numpy's to the bit.
        /// </summary>
        public static double[] Inverse(double[] m)
        {
            var a = (double[])m.Clone();
            var piv = new int[3];
            for (int j = 0; j < 3; j++)
            {
                for (int i = 0; i < j; i++) Swap(a, i, piv[i], j);
                if (j == 2) a[5] = a[5] - (a[3] * a[2] + 0.0);
                if (j == 1)
                {
                    a[4] = a[4] - (a[3] * a[1] + 0.0);
                    a[7] = a[7] - (a[6] * a[1] + 0.0);
                }
                if (j == 2) a[8] = a[8] - Fma(a[7], a[5], Fma(a[6], a[2], 0.0));
                int p = j;
                for (int i = j + 1; i < 3; i++) if (Math.Abs(a[i * 3 + j]) > Math.Abs(a[p * 3 + j])) p = i;
                piv[j] = p;
                if (a[p * 3 + j] == 0) throw new InvalidOperationException("a part's placement cannot be undone (its matrix has no inverse)");
                for (int k = 0; k <= j; k++) Swap(a, j, p, k);
                double r = 1.0 / a[j * 3 + j];
                for (int i = j + 1; i < 3; i++) a[i * 3 + j] *= r;
            }
            double d0 = 1.0 / a[0], d1 = 1.0 / a[4], d2 = 1.0 / a[8];
            var inv = new double[9];
            for (int col = 0; col < 3; col++)
            {
                var x = new double[3];
                x[col] = 1;
                for (int j = 0; j < 3; j++) { double t = x[j]; x[j] = x[piv[j]]; x[piv[j]] = t; }
                // forward, the unit lower triangle: two rows, then the third by a product kernel
                x[1] = Fma(-x[0], a[3], x[1]);
                x[2] = x[2] - Fma(a[7], x[1], Fma(a[6], x[0], 0.0));
                // back, the upper triangle: the third row, then the first two
                x[2] = x[2] * d2;
                x[0] = x[0] - (a[2] * x[2] + 0.0);
                x[1] = x[1] - (a[5] * x[2] + 0.0);
                x[1] = x[1] * d1;
                x[0] = Fma(-x[1], a[1], x[0]);
                x[0] = x[0] * d0;
                for (int i = 0; i < 3; i++) inv[i * 3 + col] = x[i];
            }
            return inv;
        }

        static void Swap(double[] a, int r1, int r2, int col)
        {
            if (r1 == r2) return;
            double t = a[r1 * 3 + col];
            a[r1 * 3 + col] = a[r2 * 3 + col];
            a[r2 * 3 + col] = t;
        }

        /// <summary>numpy's norm of a row of three: the square root of ((x*x + y*y) + z*z).</summary>
        public static double Norm(double x, double y, double z)
        {
            return Math.Sqrt((x * x + y * y) + z * z);
        }

        /// <summary>Build-NoticeBoard.py's unit(): v over its norm, or v as it is when the norm is under 1e-9.</summary>
        public static void Unit(double[] v)
        {
            double n = Norm(v[0], v[1], v[2]);
            if (n > 1e-9) { v[0] /= n; v[1] /= n; v[2] /= n; }
        }

        /// <summary>Build-NoticeBoard.py's to_byte(): round((v + 1) * 127.5), half to even, kept to 0..255.</summary>
        public static byte ToByte(double v)
        {
            double r = Math.Round((v + 1.0) * 127.5, MidpointRounding.ToEven);
            if (r < 0) r = 0;
            if (r > 255) r = 255;
            return (byte)r;
        }
    }
}
