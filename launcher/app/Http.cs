using System;
using System.IO;
using System.Net.Http;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// The launcher's own HTTP requests (Online, Roster, Verify, Discord and
    /// the release downloads in Sync), through one HttpClient.
    ///
    /// They went through HttpWebRequest and WebClient until the move to .NET
    /// 10 (#4823), where both are obsolete and are HttpClient underneath
    /// anyway. The two waits each request had are kept as they were, because
    /// they are what keeps a server that accepts the connection and then says
    /// nothing from looking like a hung launcher:
    ///
    ///   waitMs, how long the answer may take to start, was the request's
    ///   Timeout (sending the request and waiting for the status line);
    ///   readMs, how long any one read of the body may take, was its
    ///   ReadWriteTimeout, 300000 ms unless set. A large download still takes
    ///   as long as it needs, as long as bytes keep arriving.
    ///
    /// The client follows redirects and uses Windows' proxy settings, as the
    /// old requests did. Callers run on worker threads and wait for the
    /// answer, so these are synchronous.
    /// </summary>
    static class Http
    {
        /// <summary>HttpWebRequest's ReadWriteTimeout when nothing set it.</summary>
        public const int DefaultReadMs = 300000;

        static readonly HttpClient Client = new HttpClient(new SocketsHttpHandler { UseCookies = false })
        {
            // The waits are the caller's, below; the client's own would be a
            // third, for the whole body, which the old requests never had.
            Timeout = Timeout.InfiniteTimeSpan
        };

        /// <summary>
        /// Sends the request and hands back the answer once its status line
        /// and headers are in, whatever the status. Throws TimeoutException
        /// when nothing came within waitMs, and HttpRequestException when
        /// there was no answer at all.
        /// </summary>
        public static HttpResponseMessage Send(HttpRequestMessage request, int waitMs)
        {
            using (var wait = new CancellationTokenSource(waitMs))
            {
                try { return Client.Send(request, HttpCompletionOption.ResponseHeadersRead, wait.Token); }
                catch (OperationCanceledException ex) when (wait.IsCancellationRequested)
                {
                    throw new TimeoutException("The server did not answer within " + waitMs + " ms.", ex);
                }
            }
        }

        /// <summary>
        /// Copies the answer's body into to, each read allowed readMs, and
        /// says each time how many bytes have arrived in all. Throws
        /// TimeoutException when one read waited longer.
        /// </summary>
        public static void CopyBody(HttpResponseMessage response, Stream to, int readMs, Action<long> onBytes)
        {
            using (Stream s = response.Content.ReadAsStream())
            using (var read = new CancellationTokenSource())
            {
                var buf = new byte[81920];
                long had = 0;
                while (true)
                {
                    read.CancelAfter(readMs);
                    int n;
                    try { n = s.ReadAsync(buf, 0, buf.Length, read.Token).GetAwaiter().GetResult(); }
                    catch (OperationCanceledException ex) when (read.IsCancellationRequested)
                    {
                        throw new TimeoutException("The server stopped sending for " + readMs + " ms.", ex);
                    }
                    if (n == 0) return;
                    to.Write(buf, 0, n);
                    had += n;
                    if (onBytes != null) onBytes(had);
                }
            }
        }

        /// <summary>The whole body, each read allowed readMs.</summary>
        public static byte[] Body(HttpResponseMessage response, int readMs)
        {
            using (var ms = new MemoryStream())
            {
                CopyBody(response, ms, readMs, null);
                return ms.ToArray();
            }
        }

        /// <summary>
        /// A GET with the launcher's User-Agent: the body of a 2xx answer, or
        /// null for any other answer or none, which is what WebClient's
        /// DownloadData in a catch returning null gave the callers before.
        /// </summary>
        public static byte[] GetOrNull(string url, int waitMs, int readMs)
        {
            try
            {
                using (var req = new HttpRequestMessage(HttpMethod.Get, url))
                {
                    req.Headers.TryAddWithoutValidation("User-Agent", "ThornswoodLauncher/" + Updater.Version);
                    using (HttpResponseMessage res = Send(req, waitMs))
                    {
                        if (!res.IsSuccessStatusCode) return null;
                        return Body(res, readMs);
                    }
                }
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TimeoutException || ex is IOException || ex is UriFormatException || ex is InvalidOperationException)
            {
                return null;
            }
        }
    }
}
