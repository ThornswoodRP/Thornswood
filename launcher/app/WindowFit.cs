using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Platform;
using Avalonia.Threading;

namespace Thornswood
{
    /// <summary>
    /// Keeps a window inside the screen it is on, at any display scale (#463).
    ///
    /// Both exes are per-monitor DPI aware (PerMonitorV2 in their manifests),
    /// so Avalonia draws them sharp at the scale of whichever monitor they are
    /// on and keeps their size in its own units (1/96 inch) when they move. A
    /// window laid out at 1220 by 800 units is 2440 by 1600 pixels at 200
    /// percent, taller than a 1080 line screen, and its minimum size alone
    /// would push the bottom edge (and the buttons on it) off the screen. So
    /// the size and the minimum are clamped to the work area of the monitor
    /// the window is on, at startup and again whenever it lands on a monitor
    /// with another scale. The minimums from the markup are kept, so a bigger
    /// screen gets them back.
    ///
    /// The setup program compiled this file as well until #4824 retired it,
    /// which is why it uses nothing else from launcher\app (no Swallow, no
    /// Paths). Callers wrap it in their own try and log the way they log.
    /// launcher\tests\test-app-manifest.ps1 runs Clamp at 100 to 200 percent.
    /// </summary>
    static class WindowFit
    {
        /// <summary>
        /// The whole rule, in window units. workW/workH is the work area of the
        /// monitor (screen less taskbar). designMinW/designMinH are the
        /// window's own minimums from its markup. w and h come in as the size
        /// the window has now and go out as the size it should have.
        /// </summary>
        public static void Clamp(double workW, double workH, double designMinW, double designMinH,
                                 ref double w, ref double h, out double minW, out double minH)
        {
            minW = Math.Min(designMinW, workW);
            minH = Math.Min(designMinH, workH);
            w = Math.Max(minW, Math.Min(w, workW));
            h = Math.Max(minH, Math.Min(h, workH));
        }

        /// <summary>
        /// Clamps now, again once the window is open (the monitor it is really
        /// on is known then), and after every change of scale. Call it once,
        /// before the window is first shown and before it is centred.
        /// </summary>
        public static void Keep(Window win)
        {
            double designMinW = win.MinWidth, designMinH = win.MinHeight;
            Apply(win, designMinW, designMinH);
            win.Opened += delegate { Apply(win, designMinW, designMinH); };
            // Windows hands the window the new monitor's suggested rectangle
            // while the scale changes and Avalonia takes it, so the clamp runs
            // after that, not inside it, or that resize would undo it.
            win.ScalingChanged += delegate
            {
                Dispatcher.UIThread.Post(delegate { Apply(win, designMinW, designMinH); }, DispatcherPriority.Loaded);
            };
        }

        static void Apply(Window win, double designMinW, double designMinH)
        {
            Rect work = WorkAreaOf(win);
            if (work.Width <= 0 || work.Height <= 0) return;
            double w = win.Width, h = win.Height;
            if (double.IsNaN(w) || w <= 0) w = win.Bounds.Width;
            if (double.IsNaN(h) || h <= 0) h = win.Bounds.Height;
            double minW, minH;
            Clamp(work.Width, work.Height, designMinW, designMinH, ref w, ref h, out minW, out minH);
            win.MinWidth = minW;
            win.MinHeight = minH;
            if (win.WindowState != WindowState.Normal) return;
            if (w > 0 && Math.Abs(w - win.Width) > 0.5) win.Width = w;
            if (h > 0 && Math.Abs(h - win.Height) > 0.5) win.Height = h;
        }

        /// <summary>
        /// The screen the window is on. Before the window is open that is the
        /// main monitor, which is where both windows open.
        /// </summary>
        public static Screen ScreenOf(Window win)
        {
            Screens screens = win.Screens;
            if (screens == null) return null;
            Screen on = screens.ScreenFromWindow(win);
            return on ?? screens.Primary;
        }

        /// <summary>
        /// The work area of the monitor the window is on, in that monitor's
        /// window units (the screen's pixels over its scale), placed where the
        /// screen is on the desktop. Empty when no screen can be read.
        /// </summary>
        public static Rect WorkAreaOf(Window win)
        {
            Screen s = ScreenOf(win);
            if (s == null) return default(Rect);
            double scale = s.Scaling > 0 ? s.Scaling : 1;
            PixelRect work = s.WorkingArea;
            return new Rect(work.X / scale, work.Y / scale, work.Width / scale, work.Height / scale);
        }
    }
}
