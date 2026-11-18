using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;

namespace Thornswood.Tests
{
    static class NewsPictureChecks
    {
        sealed class Answer : HttpMessageHandler
        {
            internal HttpResponseMessage Response;
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                // A real HTTP handler does not resume on Avalonia's UI thread.
                // This fixture is synchronously awaited there by the check.
                if (Response == null) await Task.Delay(Timeout.Infinite, cancellationToken).ConfigureAwait(false);
                return Response;
            }
        }
        sealed class Uncounted : HttpContent
        {
            readonly byte[] bytes = new byte[4 * 1024 * 1024 + 1];
            protected override bool TryComputeLength(out long length) { length = 0; return false; }
            protected override Task SerializeToStreamAsync(Stream stream, TransportContext context) => stream.WriteAsync(bytes).AsTask();
            protected override Task<Stream> CreateContentReadStreamAsync() => Task.FromResult<Stream>(new MemoryStream(bytes));
        }

        public static void Run(Action<string, Action> check)
        {
            var type = typeof(MainWindow).Assembly.GetType("Thornswood.NewsPictures");
            var view = type.GetMethod("View", BindingFlags.Static | BindingFlags.NonPublic);
            var read = type.GetMethod("Read", BindingFlags.Static | BindingFlags.NonPublic);
            var picture = new NewsPicture { Url = "https://thornswood.net/news-panel.png", Alt = "The new character panel" };
            Func<HttpResponseMessage, byte[]> readAnswer = response =>
            {
                using (var client = new HttpClient(new Answer { Response = response }))
                    return ((Task<byte[]>)read.Invoke(null, new object[] { picture, client, CancellationToken.None })).GetAwaiter().GetResult();
            };
            check("News screenshot reads a successful response", () =>
            {
                var bytes = readAnswer(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[] { 1, 2, 3 }) });
                if (bytes == null || bytes.Length != 3) throw new Exception("the picture bytes were lost");
            });
            check("News screenshot refuses an oversized declared response", () =>
            {
                var content = new ByteArrayContent(new byte[] { 1 }); content.Headers.ContentLength = 4 * 1024 * 1024 + 1;
                if (readAnswer(new HttpResponseMessage(HttpStatusCode.OK) { Content = content }) != null) throw new Exception("size limit was ignored");
            });
            check("News screenshot refuses an oversized response without a length", () =>
            {
                var content = new Uncounted();
                if (readAnswer(new HttpResponseMessage(HttpStatusCode.OK) { Content = content }) != null) throw new Exception("stream limit was ignored");
            });
            check("News screenshot refuses a missing image", () =>
            {
                if (readAnswer(new HttpResponseMessage(HttpStatusCode.NotFound)) != null) throw new Exception("a failed response became a picture");
            });
            check("News screenshot cancels a delayed network response", () =>
            {
                using (var stop = new CancellationTokenSource(30))
                using (var client = new HttpClient(new Answer()))
                {
                    bool cancelled = false;
                    try { ((Task<byte[]>)read.Invoke(null, new object[] { picture, client, stop.Token })).GetAwaiter().GetResult(); }
                    catch (OperationCanceledException) { cancelled = true; }
                    if (!cancelled) throw new Exception("the delayed request ignored cancellation");
                }
            });
            var decode = type.GetMethod("Fetch", BindingFlags.Static | BindingFlags.NonPublic);
            foreach (string encoded in new[] {
                "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=",
                "iVBORw0KGgoAAAANSUhEUgAAIAEAAAABCAYAAACZiUteAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=", "AAAA" })
            {
                bool valid = encoded.StartsWith("iVBORw0KGgoAAAANSUhEUgAAAAIA");
                check("News production decoder validates dimensions and encoded bytes, valid=" + valid, () =>
                {
                    using (var client = new HttpClient(new Answer { Response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Convert.FromBase64String(encoded)) } }))
                    using (Bitmap decoded = Task.Run(() => (Task<Bitmap>)decode.Invoke(null, new object[] { picture, client, CancellationToken.None })).GetAwaiter().GetResult())
                    {
                        if (valid ? decoded == null || decoded.PixelSize.Width != 2 || decoded.PixelSize.Height != 1 : decoded != null)
                            throw new Exception("the production decoder accepted a bad image or lost a good one");
                    }
                });
            }
            foreach (bool available in new[] { false, true })
            {
                check("News screenshot lays out at desktop and narrow widths, available=" + available, () =>
                {
                    string opened = null;
                    int loads = 0;
                    int uiThread = Environment.CurrentManagedThreadId;
                    Func<NewsPicture, CancellationToken, Task<Bitmap>> fetch = (p, token) =>
                    {
                        if (Environment.CurrentManagedThreadId == uiThread) throw new Exception("image work ran on the window thread");
                        Interlocked.Increment(ref loads);
                        return Task.FromResult<Bitmap>(available ? new WriteableBitmap(new PixelSize(1200, 750), new Vector(96, 96), PixelFormat.Bgra8888, AlphaFormat.Premul) : null);
                    };
                    var panel = (StackPanel)view.Invoke(null, new object[] { picture, Brushes.White, (Action<string>)(s => opened = s), fetch });
                    var image = (Image)panel.Children[0]; var state = (TextBlock)panel.Children[2]; var link = (Button)panel.Children[3];
                    var win = new Window { Content = panel, Width = 900, Height = 700 }; win.Show();
                    try
                    {
                        var until = DateTime.UtcNow.AddSeconds(5);
                        while (state.Text == "Loading screenshot..." && DateTime.UtcNow < until) { Thread.Sleep(10); Dispatcher.UIThread.RunJobs(); }
                        foreach (int width in new[] { 900, 360 })
                        {
                            win.Width = width; win.UpdateLayout(); Dispatcher.UIThread.RunJobs();
                            if (state.Text == "Loading screenshot..." || image.IsVisible != available || state.IsVisible == available || image.Stretch != Stretch.Uniform || image.Bounds.Height > 480 || panel.Bounds.Width > win.ClientSize.Width + 1)
                                throw new Exception("the image or fallback did not fit");
                        }
                        link.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
                        if (opened != picture.Url || ((TextBlock)panel.Children[1]).Text != picture.Alt) throw new Exception("the full image link or caption was lost");
                        win.Content = null; Dispatcher.UIThread.RunJobs();
                        if (image.Source != null) throw new Exception("the detached image was retained");
                        win.Content = panel; win.UpdateLayout();
                        until = DateTime.UtcNow.AddSeconds(5);
                        while ((loads < 2 || state.Text == "Loading screenshot...") && DateTime.UtcNow < until) { Thread.Sleep(10); Dispatcher.UIThread.RunJobs(); }
                        if (loads != 2 || image.IsVisible != available || state.IsVisible == available || state.Text == "Loading screenshot...") throw new Exception("reattaching did not reload the picture");
                    }
                    finally { win.Close(); }
                });
            }
        }
    }
}
