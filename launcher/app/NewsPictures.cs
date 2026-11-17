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

namespace Thornswood
{
    public sealed class NewsPicture
    {
        public string Url { get; set; } = "";
        public string Alt { get; set; } = "";
    }

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
        internal static async Task<byte[]> Read(NewsPicture picture, HttpClient client)
        {
            if (picture == null || Parse("![" + picture.Alt + "](" + picture.Url + ")") == null) return null;
            using (var stop = new CancellationTokenSource(TimeSpan.FromSeconds(8)))
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

        static Bitmap Fetch(NewsPicture picture)
        {
            try
            {
                byte[] bytes = Read(picture, web).GetAwaiter().GetResult();
                if (bytes == null || bytes.Length == 0) return null;
                using (var stream = new MemoryStream(bytes)) return Bitmap.DecodeToWidth(stream, 960);
            }
            catch (Exception ex) { Swallow.Note("News screenshot", ex); return null; }
        }

        internal static StackPanel View(NewsPicture picture, IBrush ink, Action<string> open, Func<NewsPicture, Bitmap> fetch = null)
        {
            var panel = new StackPanel { Margin = new Thickness(0, 14, 0, 0), Spacing = 7 };
            var image = new Image { Stretch = Stretch.Uniform, MaxHeight = 480, IsVisible = false };
            AutomationProperties.SetName(image, picture.Alt);
            var caption = new TextBlock { Text = picture.Alt, TextWrapping = TextWrapping.Wrap, Foreground = ink, FontSize = 12 };
            var state = new TextBlock { Text = "Loading screenshot...", Foreground = ink, TextWrapping = TextWrapping.Wrap, FontSize = 11 };
            var link = new Button { Content = "Open full screenshot", HorizontalAlignment = HorizontalAlignment.Left };
            link.Click += delegate { open(picture.Url); };
            panel.Children.Add(image); panel.Children.Add(caption); panel.Children.Add(state); panel.Children.Add(link);
            bool detached = false;
            panel.DetachedFromVisualTree += delegate
            {
                detached = true;
                (image.Source as Bitmap)?.Dispose(); image.Source = null;
            };
            ThreadPool.QueueUserWorkItem(delegate
            {
                Bitmap loaded = (fetch ?? Fetch)(picture);
                Dispatcher.UIThread.Post(delegate
                {
                    if (detached) { loaded?.Dispose(); return; }
                    image.Source = loaded; image.IsVisible = loaded != null;
                    state.IsVisible = loaded == null;
                    state.Text = "The screenshot could not be loaded. You can open the full screenshot.";
                });
            });
            return panel;
        }
    }
}
