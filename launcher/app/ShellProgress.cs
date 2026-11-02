using System;
using System.Linq;
using System.Threading;
using Avalonia;
using Avalonia.Animation;
using Avalonia.Animation.Easings;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Templates;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;

namespace Thornswood
{
    /// <summary>
    /// The Play button as a progress bar (#1145): while the launcher prepares
    /// Thornswood's own game folder, puts an update in or checks files, the
    /// button fills from the left and says what it is doing and how far it
    /// has got. PlayBar in Progress.cs decides the words and the fill; this
    /// only paints them, at most every PlayBar.DrawEveryMs.
    ///
    /// The fill is "fill" in the Primary theme's template in MainWindow.axaml,
    /// behind the text: the accent colour, faded, with a solid accent line
    /// along its bottom edge. The button is off while it runs, so its face is
    /// the Card colour, and the text is drawn in Ink so it reads on both.
    /// </summary>
    static partial class Shell
    {
        static readonly PlayBar playBar = new PlayBar();
        static DispatcherTimer playBarTimer;
        static int playBarTicking;
        static Control playFill;
        static TranslateTransform playFillSlide;
        static bool playFillMoving;
        // Stops the slide when the total becomes known or the bar goes.
        static CancellationTokenSource playFillSlideStop;
        // The button's text in Ink while the bar runs; null when it is not.
        static IDisposable playInk;

        static void WireProgress()
        {
            PlayProgress.Sink = delegate(ProgressStep s)
            {
                if (s == null) playBar.Stop(); else playBar.Offer(s);
                WakePlayBar();
            };
            if (btnPlay != null)
                btnPlay.SizeChanged += delegate { if (playBar.Active) PaintPlayFill(true); };
        }

        // From any thread: make sure the timer is running. One BeginInvoke
        // per run, not one per report.
        static void WakePlayBar()
        {
            if (Interlocked.CompareExchange(ref playBarTicking, 1, 0) != 0) return;
            try { Dispatcher.UIThread.Post(StartPlayBarTimer); }
            catch (Exception ex) { Interlocked.Exchange(ref playBarTicking, 0); Swallow.Note("Shell.WakePlayBar", ex); }
        }

        static void StartPlayBarTimer()
        {
            if (playBarTimer == null)
            {
                playBarTimer = new DispatcherTimer(DispatcherPriority.Background);
                playBarTimer.Interval = TimeSpan.FromMilliseconds(PlayBar.DrawEveryMs);
                playBarTimer.Tick += delegate { PlayBarTick(); };
            }
            playBarTimer.Start();
            PlayBarTick();
        }

        static void PlayBarTick()
        {
            if (playBar.TakeDirty()) DrawPlayBar();
            if (playBar.Active) return;
            playBarTimer.Stop();
            Interlocked.Exchange(ref playBarTicking, 0);
            // A report that landed between the two lines above.
            if (playBar.Dirty) WakePlayBar();
        }

        static void DrawPlayBar()
        {
            if (btnPlay == null) return;
            bool active; string text; double fill;
            playBar.Read(out active, out text, out fill);
            if (active && !playing)
            {
                btnPlay.IsEnabled = false;
                btnPlay.Content = PlayBarCaption(text);
                ToolTip.SetTip(btnPlay, "Play comes back when this is done.");
                // Following the theme's Ink, the way a resource reference does,
                // so a theme changed while the bar runs repaints it.
                if (playInk == null) playInk = btnPlay.Bind(TemplatedControl.ForegroundProperty, btnPlay.GetResourceObservable("Ink"));
                PaintPlayFill(false);
                return;
            }
            HidePlayFill();
            // Back to whatever the button says without it: Play, or the reason
            // it is off, a failed update included.
            DrawStatus();
        }

        // The button's other words are in capitals; so are these.
        static string PlayBarCaption(string text)
        {
            return (text ?? "").ToUpperInvariant();
        }

        static bool FindPlayFill()
        {
            if (playFill != null) return true;
            if (btnPlay == null || btnPlay.Template == null) return false;
            btnPlay.ApplyTemplate();
            playFill = btnPlay.GetTemplateDescendants().OfType<Control>().FirstOrDefault(c => c.Name == "fill");
            if (playFill == null) return false;
            playFillSlide = new TranslateTransform();
            playFill.RenderTransform = playFillSlide;
            return true;
        }

        static void PaintPlayFill(bool resized)
        {
            if (!FindPlayFill()) return;
            double f = playBar.Fill;
            double w = btnPlay.Bounds.Width;
            playFill.IsVisible = true;
            if (f >= 0)
            {
                if (playFillMoving) StopPlayFillSlide();
                playFill.Width = Math.Max(0, Math.Min(1.0, f)) * w;
                return;
            }
            // Nobody knows the total yet: a quarter of the button sliding
            // steadily from end to end and back.
            if (playFillMoving && !resized) return;
            if (playFillMoving) StopPlayFillSlide();
            double band = w / 4;
            playFill.Width = band;
            var slide = new Animation();
            slide.Duration = TimeSpan.FromMilliseconds(1400);
            slide.IterationCount = IterationCount.Infinite;
            slide.PlaybackDirection = PlaybackDirection.Alternate;
            slide.Easing = new SineEaseInOut();
            var from = new KeyFrame { Cue = new Cue(0d) };
            from.Setters.Add(new Setter(TranslateTransform.XProperty, 0d));
            var to = new KeyFrame { Cue = new Cue(1d) };
            to.Setters.Add(new Setter(TranslateTransform.XProperty, Math.Max(0, w - band)));
            slide.Children.Add(from);
            slide.Children.Add(to);
            playFillSlideStop = new CancellationTokenSource();
            slide.RunAsync(playFillSlide, playFillSlideStop.Token);
            playFillMoving = true;
        }

        static void StopPlayFillSlide()
        {
            if (playFillSlideStop != null) { playFillSlideStop.Cancel(); playFillSlideStop.Dispose(); playFillSlideStop = null; }
            playFillSlide.X = 0;
            playFillMoving = false;
        }

        static void HidePlayFill()
        {
            if (playInk != null) { playInk.Dispose(); playInk = null; }
            if (playFill == null) return;
            if (playFillMoving) StopPlayFillSlide();
            playFill.Width = 0;
            playFill.IsVisible = false;
        }
    }
}
