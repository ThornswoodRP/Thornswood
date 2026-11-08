using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Text;
using Thornswood.DeployAgent;
using Xunit;

namespace Thornswood.DeployAgent.Tests;

/// <summary>The box runners' proxy (#5495), against a stand-in upstream on
/// loopback. Every ClientHello here is a real one, made by SslStream.</summary>
public class EgressTests
{
    static readonly string[] Rules = ["github.com", "*.actions.githubusercontent.com", "pypi.org"];

    [Fact]
    public void A_pattern_takes_names_under_it_and_nothing_else()
    {
        var r = new HostRules(Rules);
        Assert.True(r.Allows("vstoken.actions.githubusercontent.com"));
        Assert.True(r.Allows("VSTOKEN.Actions.GitHubUserContent.com."));
        Assert.True(r.Allows("github.com"));
        Assert.False(r.Allows("actions.githubusercontent.com"));
        Assert.False(r.Allows("evilactions.githubusercontent.com"));
        Assert.False(r.Allows("vstoken.actions.githubusercontent.com.evil.example"));
        Assert.False(r.Allows("api.github.com"));
        Assert.False(r.Allows("203.0.113.16"));
        Assert.False(r.Allows("github.com:443"));
        Assert.False(r.Allows("git hub.com"));
    }

    [Theory]
    [InlineData("*")]
    [InlineData("*.com")]
    [InlineData("localhost")]
    [InlineData("10.0.0.1")]
    [InlineData("exa mple.com")]
    public void A_list_entry_that_would_let_too_much_out_is_refused(string entry) =>
        Assert.Throws<ConfigException>(() => new HostRules([entry]));

    [Fact]
    public void The_proxy_listens_on_loopback_only()
    {
        var e = Assert.Throws<ConfigException>(() => EgressConfig.Parse("""{"listen":"0.0.0.0:8431","allow":["github.com"],"home":"x"}""", "egress.json"));
        Assert.Contains("loopback", e.Message);
        Assert.Throws<ConfigException>(() => EgressConfig.Parse("""{"listen":"127.0.0.1:8431","allow":[],"home":"x"}""", "egress.json"));
        var ok = EgressConfig.Parse("""{"listen":"127.0.0.1:8431","allow":["github.com"],"home":"x"}""", "egress.json");
        Assert.Equal(8431, ok.Listen.Port);
    }

    [Fact]
    public async Task The_server_name_is_read_out_of_a_real_ClientHello()
    {
        var hello = await ClientHello("vstoken.actions.githubusercontent.com");
        Assert.Equal(hello.Length, TlsHello.RecordLength(hello));
        Assert.Equal("vstoken.actions.githubusercontent.com", TlsHello.ServerName(hello));
        Assert.Null(TlsHello.ServerName(hello.AsSpan(0, hello.Length - 10)));
        Assert.Equal(-1, TlsHello.RecordLength("GET / HTTP/1.1\r\n"u8));
    }

    [Fact]
    public void IsPublic_keeps_the_proxy_off_loopback_and_the_private_ranges()
    {
        foreach (var a in new[] { "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1" })
            Assert.False(EgressProxy.IsPublic(IPAddress.Parse(a)), a);
        foreach (var a in new[] { "203.0.113.16", "198.51.100.3", "2606:50c0:8000::153" })
            Assert.True(EgressProxy.IsPublic(IPAddress.Parse(a)), a);
    }

    [Fact]
    public async Task A_listed_host_whose_ClientHello_names_it_goes_through()
    {
        await using var h = await Harness.Start();
        var hello = await ClientHello("vstoken.actions.githubusercontent.com");
        using var c = await h.Connect("CONNECT vstoken.actions.githubusercontent.com:443 HTTP/1.1\r\nHost: vstoken.actions.githubusercontent.com:443\r\n\r\n");
        Assert.StartsWith("HTTP/1.1 200", await ReadHead(c));
        var s = c.GetStream();
        await s.WriteAsync(hello);
        await s.WriteAsync("PING"u8.ToArray());
        var back = await ReadExactly(s, hello.Length + 4);
        Assert.Equal(hello.Concat("PING"u8.ToArray()).ToArray(), back);
        Assert.Equal(1, h.UpstreamConnections);
        Assert.Contains(h.Lines, l => l.Contains("vstoken.actions.githubusercontent.com -> 127.0.0.1"));
    }

    [Fact]
    public async Task A_host_off_the_list_is_refused_before_anything_leaves()
    {
        await using var h = await Harness.Start();
        using var c = await h.Connect("CONNECT onedrive.live.com:443 HTTP/1.1\r\n\r\n");
        Assert.StartsWith("HTTP/1.1 403", await ReadHead(c));
        Assert.Equal(0, h.UpstreamConnections);
        Assert.Contains(h.Lines, l => l.Contains("REFUSED onedrive.live.com:443"));
    }

    [Fact]
    public async Task A_listed_host_on_another_port_is_refused()
    {
        await using var h = await Harness.Start();
        using var c = await h.Connect("CONNECT github.com:22 HTTP/1.1\r\n\r\n");
        Assert.StartsWith("HTTP/1.1 403", await ReadHead(c));
        Assert.Equal(0, h.UpstreamConnections);
    }

    [Fact]
    public async Task A_tunnel_for_a_listed_host_cannot_ask_its_edge_for_another()
    {
        await using var h = await Harness.Start();
        var hello = await ClientHello("onedrive.live.com");
        using var c = await h.Connect("CONNECT vstoken.actions.githubusercontent.com:443 HTTP/1.1\r\n\r\n");
        Assert.StartsWith("HTTP/1.1 200", await ReadHead(c));
        await c.GetStream().WriteAsync(hello);
        Assert.Equal(0, await c.GetStream().ReadAsync(new byte[16]));
        Assert.Equal(0, h.UpstreamConnections);
        Assert.Contains(h.Lines, l => l.Contains("names onedrive.live.com, not the host it asked for"));
    }

    [Fact]
    public async Task Plain_bytes_after_CONNECT_are_not_let_out()
    {
        await using var h = await Harness.Start();
        using var c = await h.Connect("CONNECT github.com:443 HTTP/1.1\r\n\r\n");
        Assert.StartsWith("HTTP/1.1 200", await ReadHead(c));
        await c.GetStream().WriteAsync("GET / HTTP/1.1\r\nHost: evil\r\n\r\n"u8.ToArray());
        Assert.True(await Ends(c));
        Assert.Equal(0, h.UpstreamConnections);
        Assert.Contains(h.Lines, l => l.Contains("is not TLS"));
    }

    [Fact]
    public async Task A_plain_HTTP_request_gets_405()
    {
        await using var h = await Harness.Start();
        using var c = await h.Connect("GET http://github.com/ HTTP/1.1\r\nHost: github.com\r\n\r\n");
        Assert.StartsWith("HTTP/1.1 405", await ReadHead(c));
        Assert.Equal(0, h.UpstreamConnections);
    }

    [Fact]
    public async Task A_name_that_resolves_only_to_private_addresses_goes_nowhere()
    {
        await using var h = await Harness.Start(realRule: true);
        var hello = await ClientHello("pypi.org");
        using var c = await h.Connect("CONNECT pypi.org:443 HTTP/1.1\r\n\r\n");
        Assert.StartsWith("HTTP/1.1 200", await ReadHead(c));
        await c.GetStream().WriteAsync(hello);
        Assert.Equal(0, await c.GetStream().ReadAsync(new byte[16]));
        Assert.Equal(0, h.UpstreamConnections);
        Assert.Contains(h.Lines, l => l.Contains("resolves only to addresses the proxy never goes to"));
    }

    // ---- helpers -------------------------------------------------------------

    /// <summary>The first record SslStream sends when it opens TLS to host.</summary>
    static async Task<byte[]> ClientHello(string host)
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        try
        {
            using var c = new TcpClient();
            await c.ConnectAsync(IPAddress.Loopback, ((IPEndPoint)l.LocalEndpoint).Port);
            using var server = await l.AcceptTcpClientAsync();
            var ssl = new SslStream(c.GetStream());
            var hs = ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = host, RemoteCertificateValidationCallback = (_, _, _, _) => true });
            var s = server.GetStream();
            var head = await ReadExactly(s, 5);
            var rec = head.Concat(await ReadExactly(s, TlsHello.RecordLength(head) - 5)).ToArray();
            server.Close();
            try { await hs; } catch (Exception e) when (e is IOException or System.Security.Authentication.AuthenticationException) { }
            return rec;
        }
        finally { l.Stop(); }
    }

    static async Task<byte[]> ReadExactly(Stream s, int n)
    {
        var b = new byte[n];
        using var t = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await s.ReadExactlyAsync(b, t.Token);
        return b;
    }

    /// <summary>True when the proxy ended the connection without sending
    /// anything. It reads only a record header before refusing, so the rest
    /// of what was sent is still unread when it closes, and a socket closed
    /// with unread data ends with a reset rather than a clean close (RFC 1122
    /// 4.2.2.13; Windows does it every time, Linux when the data is there in
    /// time). Either way nothing came back.</summary>
    static async Task<bool> Ends(TcpClient c)
    {
        using var t = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        try { return await c.GetStream().ReadAsync(new byte[16], t.Token) == 0; }
        catch (IOException e) when (e.InnerException is SocketException { SocketErrorCode: SocketError.ConnectionReset }) { return true; }
    }

    static async Task<string> ReadHead(TcpClient c)
    {
        var s = c.GetStream();
        var sb = new StringBuilder();
        var one = new byte[1];
        using var t = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!sb.ToString().EndsWith("\r\n\r\n") && await s.ReadAsync(one, t.Token) == 1) sb.Append((char)one[0]);
        return sb.ToString();
    }

    /// <summary>The proxy with every name resolving to 127.0.0.1 (or, with
    /// realRule, to 10.0.0.5 and held to IsPublic), and an upstream on
    /// loopback that sends back whatever it is sent.</summary>
    sealed class Harness : IAsyncDisposable
    {
        readonly CancellationTokenSource stop = new();
        readonly TcpListener upstream = new(IPAddress.Loopback, 0);
        EgressProxy proxy = null!;
        Task run = Task.CompletedTask, echo = Task.CompletedTask;
        int connections;
        public readonly List<string> Lines = new();
        public int UpstreamConnections => Volatile.Read(ref connections);

        public static async Task<Harness> Start(bool realRule = false)
        {
            var h = new Harness();
            h.upstream.Start();
            var port = ((IPEndPoint)h.upstream.LocalEndpoint).Port;
            h.echo = Task.Run(async () =>
            {
                while (!h.stop.IsCancellationRequested)
                {
                    TcpClient c;
                    try { c = await h.upstream.AcceptTcpClientAsync(h.stop.Token); }
                    catch (OperationCanceledException) { return; }
                    Interlocked.Increment(ref h.connections);
                    _ = Task.Run(async () => { using (c) { try { await c.GetStream().CopyToAsync(c.GetStream(), h.stop.Token); } catch (Exception e) when (e is IOException or OperationCanceledException) { } } });
                }
            });
            var cfg = EgressConfig.Parse("""{"listen":"127.0.0.1:1","allow":["github.com","*.actions.githubusercontent.com","pypi.org"],"home":"x"}""", "test");
            cfg = new EgressConfig { Listen = new IPEndPoint(IPAddress.Loopback, 0), Allow = cfg.Allow, Home = cfg.Home };
            h.proxy = new EgressProxy(cfg, l => { lock (h.Lines) h.Lines.Add(l); })
            {
                Resolve = (_, _) => Task.FromResult(new[] { IPAddress.Parse(realRule ? "10.0.0.5" : "127.0.0.1") }),
                MayReach = realRule ? EgressProxy.IsPublic : _ => true,
                UpstreamPort = port,
                Wait = TimeSpan.FromSeconds(5),
            };
            h.run = h.proxy.Run(h.stop.Token);
            await h.proxy.Listening;
            return h;
        }

        public async Task<TcpClient> Connect(string request)
        {
            var c = new TcpClient();
            await c.ConnectAsync(IPAddress.Loopback, proxy.Port);
            await c.GetStream().WriteAsync(Encoding.ASCII.GetBytes(request));
            return c;
        }

        public async ValueTask DisposeAsync()
        {
            stop.Cancel();
            upstream.Stop();
            try { await run; } catch (OperationCanceledException) { }
            try { await echo; } catch (OperationCanceledException) { }
        }
    }
}
