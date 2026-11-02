using System;
using System.IO;
using System.Reflection;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using SkiaSharp;

namespace Thornswood
{
    /// <summary>
    /// The emblem and the picture behind the title band, compiled into the exe
    /// as resources.
    ///
    /// They live inside the executable rather than beside it so that the update
    /// which replaces the launcher carries its own artwork. A loose image file
    /// would need its own line in the packager, its own line in the publisher,
    /// and would eventually go missing on somebody's machine.
    /// </summary>
    static class Art
    {
        static Bitmap cached;
        static bool tried;

        static ImageBrush header;
        static bool triedHeader;

        /// <summary>
        /// True in the dev build. Set by Shell as soon as the config is read,
        /// before anything asks for the emblem. The shortcut icon reads
        /// Icons.Dev, set beside it.
        /// </summary>
        public static bool Dev;

        /// <summary>
        /// The emblem: logo.png on the main build, logo-dev.png on the dev
        /// build (Djinn, 25 Sep: the new emblem is the dev launcher's only,
        /// main keeps its own). A dev build without logo-dev.png falls back
        /// to logo.png.
        /// </summary>
        public static Bitmap Emblem()
        {
            if (tried) return cached;
            tried = true;
            if (Dev) cached = Load("logo-dev.png");
            if (cached == null) cached = Load("logo.png");
            return cached;
        }

        /// <summary>
        /// The window's icon when this build carries no emblem: the exe's own
        /// icon, app-dev.ico on the dev build and app.ico on main, from the
        /// same resources. Null when neither is there.
        /// </summary>
        public static WindowIcon AppIcon()
        {
            byte[] ico = null;
            if (Dev) ico = Bytes("app-dev.ico");
            if (ico == null) ico = Bytes("app.ico");
            if (ico == null) return null;
            using (var ms = new MemoryStream(ico)) return new WindowIcon(ms);
        }

        /// <summary>
        /// Which part of the strip the title band shows, as fractions of the
        /// picture: the whole width, and the 70% of the height centred on the
        /// overlook, rows 24 to 234 of the 300 the picture is tall.
        ///
        /// The band is as tall as the title row, 100, and as wide as the window
        /// less the side column, so it is between 8 and 17 times wider than it
        /// is tall while the picture itself is 5.1. Filling the band has to lose
        /// height whatever we do; this says which height. The approved framing
        /// holds two things together: the sunrise and the far shore, rows 60 to
        /// 85, and the figure at the overlook, whose head is rows 126 to 160.
        /// Left to the middle of the picture the band slides down off both as
        /// the window widens. It showed rows 74 to 226 at the default width,
        /// which is the far shore in a sliver and 40 rows of foreground rock;
        /// 105 to 195 maximised, with no horizon left at all; and 126 to 174 on
        /// an ultrawide, where the top edge sits on the figure's head. Centred
        /// on row 129 it shows 53 to 205, 84 to 174 and 105 to 153: the far
        /// shore and the whole head together up to a window 1950 wide, which
        /// covers a maximised 1920 screen, and the figure still in frame out to
        /// an ultrawide. The slice is also always narrower than the band, so
        /// nothing is ever taken off the sides.
        ///
        /// Fractions, not pixels, because the picture is 1535 wide and the
        /// video 1536: read as fractions of whichever one is being painted, the
        /// two crop to the same rows and the strip does not jump when the video
        /// starts. Shell.StartHeaderVideo paints with this same rectangle.
        /// </summary>
        public static readonly RelativeRect HeaderCrop = new RelativeRect(0, 0.08, 1, 0.70, RelativeUnit.Relative);

        /// <summary>
        /// A brush that fills the band with the part of a picture HeaderCrop
        /// names, cropping what does not fit the way a desktop wallpaper does.
        /// The still picture and the moving one are both painted through one
        /// of these, so the two line up.
        /// </summary>
        public static ImageBrush BandBrush(IImageBrushSource source)
        {
            var b = new ImageBrush(source);
            b.Stretch = Stretch.UniformToFill;
            b.AlignmentX = AlignmentX.Center;
            b.AlignmentY = AlignmentY.Center;
            b.SourceRect = HeaderCrop;
            return b;
        }

        /// <summary>
        /// The strip of landscape behind the title on the Play page. Null when
        /// this build carries no picture, and the band then keeps its pattern.
        ///
        /// The picture is held still: no zoom, no drift, no scale of any kind.
        /// </summary>
        public static ImageBrush Header()
        {
            if (triedHeader) return header;
            triedHeader = true;
            Bitmap bi = Load("launcher-header.jpg");
            if (bi != null) header = BandBrush(bi);
            return header;
        }

        /// <summary>
        /// The same strip moving: launcher-header.webp, an animated WebP made
        /// from the old mp4 with the same 720 frames at 30 a second, the same
        /// 1536 by 300 and the same endless loop. It is read straight out of
        /// the exe and decoded here one frame at a time, so nothing is written
        /// to disk and nothing in Windows has to be able to play video. Null
        /// when this build carries none or it cannot be read, and the band then
        /// keeps the still picture.
        /// </summary>
        public static HeaderFrames HeaderVideo()
        {
            byte[] bytes = Bytes("launcher-header.webp");
            if (bytes == null || bytes.Length == 0) return null;
            return HeaderFrames.Open(bytes);
        }

        static byte[] Bytes(string name)
        {
            Assembly asm = typeof(Art).Assembly;
            string pick = null;
            foreach (string n in asm.GetManifestResourceNames())
                if (n.EndsWith(name, StringComparison.OrdinalIgnoreCase)) { pick = n; break; }
            if (pick == null) return null;

            using (Stream st = asm.GetManifestResourceStream(pick))
            {
                if (st == null) return null;
                var ms = new MemoryStream();
                st.CopyTo(ms);
                return ms.ToArray();
            }
        }

        /// <summary>
        /// A picture from the resources, decoded now and held in memory, so
        /// nothing reads the resource again later. Null when this build does
        /// not carry it.
        /// </summary>
        static Bitmap Load(string name)
        {
            byte[] bytes = Bytes(name);
            if (bytes == null) return null;
            using (var ms = new MemoryStream(bytes)) return new Bitmap(ms);
        }
    }

    /// <summary>
    /// The moving strip, decoded one frame at a time in order and looping.
    ///
    /// Each frame of the WebP is drawn on top of the one before it (only frame
    /// 0 stands on its own: 719 of the 720 are the parts that changed), so the
    /// frames are decoded in order into one picture that is kept between them,
    /// and that picture is the frame. Measured on 1 Nov 2026 in a Linux cloud
    /// container with SkiaSharp 3.119.4, a frame took 10 ms to decode (median
    /// of two loops, 12 ms at the 95th percentile), a third of the 33 ms it is
    /// on screen, which is why Shell decodes them off the window's thread.
    ///
    /// Only the thread Shell.StartHeaderVideo starts calls Next and CopyTo.
    /// </summary>
    sealed class HeaderFrames : IDisposable
    {
        readonly SKData data;
        readonly SKCodec codec;
        readonly SKCodecFrameInfo[] frames;
        readonly SKImageInfo info;
        readonly SKBitmap picture;
        int at = -1;

        HeaderFrames(SKData data, SKCodec codec)
        {
            this.data = data;
            this.codec = codec;
            frames = codec.FrameInfo;
            info = new SKImageInfo(codec.Info.Width, codec.Info.Height, SKColorType.Bgra8888, SKAlphaType.Premul);
            picture = new SKBitmap(info);
        }

        /// <summary>Null when the bytes are not a WebP with at least one frame.</summary>
        public static HeaderFrames Open(byte[] bytes)
        {
            SKData data = SKData.CreateCopy(bytes);
            SKCodec codec = SKCodec.Create(data);
            if (codec == null || codec.FrameCount < 1 || codec.Info.Width < 1 || codec.Info.Height < 1)
            {
                if (codec != null) codec.Dispose();
                data.Dispose();
                return null;
            }
            return new HeaderFrames(data, codec);
        }

        public int Width { get { return info.Width; } }
        public int Height { get { return info.Height; } }

        /// <summary>
        /// Decodes the next frame, going back to the first after the last, and
        /// says how long it stays on screen. Throws with Skia's reason when a
        /// frame will not decode.
        /// </summary>
        public TimeSpan Next()
        {
            at = (at + 1) % frames.Length;
            // The frame this one is drawn on is the one before it, which is
            // what the picture holds. A frame that stands on its own (the
            // first) is decoded onto nothing.
            int prior = frames[at].RequiredFrame == -1 ? -1 : (at == 0 ? frames.Length - 1 : at - 1);
            SKCodecResult r = codec.GetPixels(info, picture.GetPixels(), info.RowBytes, new SKCodecOptions(at, prior));
            if (r != SKCodecResult.Success)
                throw new InvalidDataException("frame " + at + " of the title video did not decode: " + r);
            // A frame with no length of its own shows for a thirtieth of a
            // second, the rate the strip was made at.
            int ms = frames[at].Duration > 0 ? frames[at].Duration : 33;
            return TimeSpan.FromMilliseconds(ms);
        }

        /// <summary>
        /// Copies the frame Next decoded into a locked bitmap of the same size
        /// and the same 32 bit BGRA layout.
        /// </summary>
        public unsafe void CopyTo(IntPtr to, int toRowBytes)
        {
            byte* src = (byte*)picture.GetPixels();
            byte* dst = (byte*)to;
            int row = info.RowBytes;
            int width = Math.Min(row, toRowBytes);
            for (int y = 0; y < info.Height; y++)
                Buffer.MemoryCopy(src + (long)y * row, dst + (long)y * toRowBytes, width, width);
        }

        public void Dispose()
        {
            picture.Dispose();
            codec.Dispose();
            data.Dispose();
        }
    }
}
