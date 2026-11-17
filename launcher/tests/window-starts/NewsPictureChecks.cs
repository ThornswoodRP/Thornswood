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
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(Response);
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
                    return ((Task<byte[]>)read.Invoke(null, new object[] { picture, client })).GetAwaiter().GetResult();
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
                var content = new StreamContent(new MemoryStream(new byte[4 * 1024 * 1024 + 1]));
                content.Headers.ContentLength = null;
                if (readAnswer(new HttpResponseMessage(HttpStatusCode.OK) { Content = content }) != null) throw new Exception("stream limit was ignored");
            });
            check("News screenshot refuses a missing image", () =>
            {
                if (readAnswer(new HttpResponseMessage(HttpStatusCode.NotFound)) != null) throw new Exception("a failed response became a picture");
            });
            foreach (bool available in new[] { false, true })
            {
                check("News screenshot lays out at desktop and narrow widths, available=" + available, () =>
                {
                    string opened = null;
                    Func<NewsPicture, Bitmap> fetch = p => available
                        ? new WriteableBitmap(new PixelSize(1200, 750), new Vector(96, 96), PixelFormat.Bgra8888, AlphaFormat.Premul) : null;
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
                    }
                    finally { win.Close(); }
                });
            }
        }
    }
}
