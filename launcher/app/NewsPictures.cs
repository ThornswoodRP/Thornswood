using System;
using System.IO;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using SkiaSharp;

namespace Thornswood
{
    static class NewsPictures
    {
        static readonly Regex Line = new Regex(@"^!\[([^\]\r\n]{1,160})\]\((https://thornswood\.net/news-[a-z0-9][a-z0-9-]{0,119}\.(?:png|jpg|webp))\)$");
        static readonly Regex Controls = new Regex(@"[\x00-\x1f\x7f]");
        const int MaxBytes = 4 * 1024 * 1024;
        static readonly HttpClient web = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
        { Timeout = TimeSpan.FromSeconds(8) };

        internal static NewsPicture Parse(string line)
        {
            Match m = Line.Match(line ?? "");
            if (!m.Success) return null;
            string alt = m.Groups[1].Value.Trim();
            return alt.Length == 0 || Controls.IsMatch(alt) ? null : new NewsPicture { Url = m.Groups[2].Value, Alt = alt };
        }

        // Kept separate from decoding and the view so the response size and
        // timeout are checked even when a server omits Content-Length.
        internal static async Task<byte[]> Read(NewsPicture picture, HttpClient client, CancellationToken cancelled)
        {
            if (picture == null || Parse("![" + picture.Alt + "](" + picture.Url + ")") == null) return null;
            using (var stop = CancellationTokenSource.CreateLinkedTokenSource(cancelled))
            {
                stop.CancelAfter(TimeSpan.FromSeconds(8));
                using (HttpResponseMessage response = await client.GetAsync(picture.Url, HttpCompletionOption.ResponseHeadersRead, stop.Token).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength > MaxBytes) return null;
                    using (Stream body = await response.Content.ReadAsStreamAsync(stop.Token).ConfigureAwait(false))
                    using (var bytes = new MemoryStream())
                    {
                        byte[] buffer = new byte[16384];
                        int count;
                        while ((count = await body.ReadAsync(buffer.AsMemory(), stop.Token).ConfigureAwait(false)) > 0)
                        {
                            if (bytes.Length + count > MaxBytes) return null;
                            bytes.Write(buffer, 0, count);
                        }
                        return bytes.ToArray();
                    }
                }
            }
        }

        internal static async Task<Bitmap> Fetch(NewsPicture picture, HttpClient client, CancellationToken cancelled)
        {
            using (var stop = CancellationTokenSource.CreateLinkedTokenSource(cancelled))
            {
                stop.CancelAfter(TimeSpan.FromSeconds(8));
                byte[] bytes = await Read(picture, client, stop.Token).ConfigureAwait(false);
                if (bytes == null || bytes.Length == 0) return null;
                // Read dimensions before allocating pixels. Both source and
                // displayed dimensions are bounded, including tall pictures.
                using (var codec = SKCodec.Create(new MemoryStream(bytes)))
                {
                    if (codec == null) return null;
                    int w = codec.Info.Width, h = codec.Info.Height;
                    if (w <= 0 || h <= 0 || w > 8192 || h > 8192 || (long)w * h > 16000000) return null;
                    stop.Token.ThrowIfCancellationRequested();
                    Bitmap decoded;
                    using (var stream = new MemoryStream(bytes))
                        decoded = (double)h / w > 600.0 / 960
                            ? Bitmap.DecodeToHeight(stream, Math.Min(h, 600))
                            : Bitmap.DecodeToWidth(stream, Math.Min(w, 960));
                    if (stop.IsCancellationRequested) { decoded.Dispose(); stop.Token.ThrowIfCancellationRequested(); }
                    return decoded;
                }
            }
        }

        internal static StackPanel View(NewsPicture picture, IBrush ink, Action<string> open, Func<NewsPicture, CancellationToken, Task<Bitmap>> fetch = null)
        {
            var panel = new StackPanel { Margin = new Thickness(0, 14, 0, 0), Spacing = 7 };
            var image = new Image { Stretch = Stretch.Uniform, MaxHeight = 480, IsVisible = false };
            AutomationProperties.SetName(image, picture.Alt);
            var caption = new TextBlock { Text = picture.Alt, TextWrapping = TextWrapping.Wrap, Foreground = ink, FontSize = 12 };
            var state = new TextBlock { Text = "Loading screenshot...", Foreground = ink, TextWrapping = TextWrapping.Wrap, FontSize = 11 };
            var link = new Button { Content = "Open full screenshot", HorizontalAlignment = HorizontalAlignment.Left };
            link.Click += delegate { open(picture.Url); };
            panel.Children.Add(image); panel.Children.Add(caption); panel.Children.Add(state); panel.Children.Add(link);
            int generation = 0;
            CancellationTokenSource loading = null;
            panel.DetachedFromVisualTree += delegate
            {
                generation++;
                loading?.Cancel(); loading?.Dispose(); loading = null;
                (image.Source as Bitmap)?.Dispose(); image.Source = null;
                image.IsVisible = false;
            };
            panel.AttachedToVisualTree += delegate
            {
                int mine = ++generation;
                loading = new CancellationTokenSource();
                CancellationToken token = loading.Token;
                state.Text = "Loading screenshot..."; state.IsVisible = true;
                _ = Task.Run(async delegate
                {
                    Bitmap loaded = null;
                    try { loaded = await (fetch != null ? fetch(picture, token) : Fetch(picture, web, token)).ConfigureAwait(false); }
                    catch (Exception ex)
                    {
                        // Leaving the page cancels its work normally. A
                        // timeout while it is still attached is a failed load.
                        if (!(ex is OperationCanceledException) || !token.IsCancellationRequested) Swallow.Note("News screenshot", ex);
                    }
                    Dispatcher.UIThread.Post(delegate
                    {
                        if (mine != generation) { loaded?.Dispose(); return; }
                        image.Source = loaded; image.IsVisible = loaded != null;
                        state.IsVisible = loaded == null;
                        state.Text = "The screenshot could not be loaded. You can open the full screenshot.";
                    });
                });
            };
            return panel;
        }
    }
}
