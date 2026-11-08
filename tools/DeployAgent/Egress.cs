#nullable enable
using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace Thornswood.DeployAgent;

// The box runners' way out (#5495). The runner accounts' firewall rules
// (Install-Runner.ps1) block every address but loopback, so a runner and
// every job it runs reach the internet only through this proxy, on loopback,
// which lets a connection out only to a host its list names. It decides by
// name because an address cannot say which host it is: on 3 Nov GitHub gave
// tw-hermes-box the token host vstoken.actions.githubusercontent.com, on an
// edge address many Microsoft services share, and a rule that let that
// address out would have let a job reach all of them.
//
// What a client may do: CONNECT a listed host on port 443, then speak TLS
// whose ClientHello names that same host (its SNI). The proxy reads the name
// out of the ClientHello before it connects anywhere, so a tunnel opened for
// a listed host cannot ask the shared edge behind it for another. It
// resolves the name itself and goes only to public addresses, never to
// loopback or the private ranges. Nothing else is served: a plain HTTP
// request gets 405, a host or port off the list gets 403, a mismatched or
// missing SNI ends the tunnel, and each is a line in the log saying so.

/// <summary>egress.json: where the proxy listens (loopback only), the hosts
/// it lets out, and its folder (logs under it).</summary>
public sealed class EgressConfig
{
    public IPEndPoint Listen { get; init; } = new(IPAddress.Loopback, 0);
    public required HostRules Allow { get; init; }
    public string Home { get; init; } = "";

    public static EgressConfig Load(string path) => Parse(File.ReadAllText(path), path);

    public static EgressConfig Parse(string json, string where)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        string Text(string name) =>
            root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : throw new ConfigException($"{where} has no \"{name}\"");
        var listen = Text("listen");
        if (!IPEndPoint.TryParse(listen, out var ep) || ep.Port == 0) throw new ConfigException($"\"listen\" is not an address and port: {listen}");
        if (!IPAddress.IsLoopback(ep.Address)) throw new ConfigException($"\"listen\" must be a loopback address, so only this machine reaches the proxy: {listen}");
        if (!root.TryGetProperty("allow", out var allow) || allow.ValueKind != JsonValueKind.Array) throw new ConfigException($"{where} has no \"allow\" list");
        var hosts = allow.EnumerateArray().Select(h => h.ValueKind == JsonValueKind.String ? h.GetString()! : throw new ConfigException("every \"allow\" entry is a host name")).ToArray();
        return new EgressConfig { Listen = ep, Allow = new HostRules(hosts), Home = Text("home") };
    }
}

/// <summary>The hosts a connection may go to: an exact name, or "*.a.b",
/// which takes any name ending ".a.b" and not "a.b" itself. A pattern needs
/// two labels after its star, so "*.com" or "*" is refused when the list is
/// read rather than letting everything out.</summary>
public sealed class HostRules
{
    readonly HashSet<string> exact = new(StringComparer.Ordinal);
    readonly List<string> suffixes = new();

    public HostRules(IEnumerable<string> entries)
    {
        foreach (var raw in entries)
        {
            var e = raw.Trim().ToLowerInvariant().TrimEnd('.');
            if (e.StartsWith("*."))
            {
                var rest = e[2..];
                if (!IsName(rest) || rest.Split('.').Length < 2) throw new ConfigException($"\"{raw}\" is too wide: a pattern needs two labels after its *");
                suffixes.Add("." + rest);
            }
            else if (IsName(e) && e.Contains('.') && !IPAddress.TryParse(e, out _)) exact.Add(e);
            else throw new ConfigException($"\"{raw}\" is not a host name");
        }
        if (exact.Count == 0 && suffixes.Count == 0) throw new ConfigException("the \"allow\" list is empty");
    }

    public int Count => exact.Count + suffixes.Count;

    /// <summary>A name as a client sent it, lower-cased and without its
    /// final dot, or null when it is not a host name (an address, a port,
    /// anything with characters a name does not have).</summary>
    public static string? Normalize(string host)
    {
        var h = host.Trim().ToLowerInvariant().TrimEnd('.');
        return IsName(h) && !IPAddress.TryParse(h, out _) ? h : null;
    }

    public bool Allows(string host)
    {
        var h = Normalize(host);
        if (h == null) return false;
        if (exact.Contains(h)) return true;
        foreach (var s in suffixes) if (h.Length > s.Length && h.EndsWith(s, StringComparison.Ordinal)) return true;
        return false;
    }

    static bool IsName(string h)
    {
        if (h.Length is 0 or > 253) return false;
        foreach (var label in h.Split('.'))
        {
            if (label.Length is 0 or > 63 || label[0] == '-' || label[^1] == '-') return false;
            foreach (var c in label) if (!(c is >= 'a' and <= 'z' or >= '0' and <= '9' or '-')) return false;
        }
        return true;
    }
}

/// <summary>Reads the server name out of a TLS ClientHello record.</summary>
public static class TlsHello
{
    /// <summary>The length of the whole record the five header bytes start,
    /// or -1 when they are not a TLS handshake record.</summary>
    public static int RecordLength(ReadOnlySpan<byte> header)
    {
        if (header.Length < 5 || header[0] != 0x16 || header[1] != 0x03) return -1;
        int n = BinaryPrimitives.ReadUInt16BigEndian(header[3..5]);
        return n is 0 or > 16384 ? -1 : 5 + n;
    }

    /// <summary>The host_name of the server_name extension of the
    /// ClientHello in this record, or null when the record is not a whole
    /// ClientHello or names no host.</summary>
    public static string? ServerName(ReadOnlySpan<byte> record)
    {
        try
        {
            if (RecordLength(record) != record.Length) return null;
            var p = record[5..];
            if (p[0] != 0x01) return null;
            int hlen = (p[1] << 16) | (p[2] << 8) | p[3];
            if (hlen + 4 > p.Length) return null;
            var h = p.Slice(4, hlen);
            int i = 2 + 32;
            i += 1 + h[i];
            i += 2 + BinaryPrimitives.ReadUInt16BigEndian(h[i..]);
            i += 1 + h[i];
            int extEnd = i + 2 + BinaryPrimitives.ReadUInt16BigEndian(h[i..]);
            if (extEnd > h.Length) return null;
            i += 2;
            while (i + 4 <= extEnd)
            {
                int type = BinaryPrimitives.ReadUInt16BigEndian(h[i..]);
                int len = BinaryPrimitives.ReadUInt16BigEndian(h[(i + 2)..]);
                var body = h.Slice(i + 4, len);
                if (type == 0)
                {
                    int listEnd = 2 + BinaryPrimitives.ReadUInt16BigEndian(body);
                    int j = 2;
                    while (j + 3 <= listEnd)
                    {
                        int nlen = BinaryPrimitives.ReadUInt16BigEndian(body[(j + 1)..]);
                        if (body[j] == 0) return Encoding.ASCII.GetString(body.Slice(j + 3, nlen));
                        j += 3 + nlen;
                    }
                    return null;
                }
                i += 4 + len;
            }
            return null;
        }
        // A record cut short reads past its end: it names no host.
        catch (ArgumentOutOfRangeException) { return null; }
        catch (IndexOutOfRangeException) { return null; }
    }
}

/// <summary>The proxy. Resolve and MayReach are the DNS lookup and the
/// address rule, and UpstreamPort the port it connects to (443); the tests
/// set them to reach a stand-in server on loopback.</summary>
public sealed class EgressProxy(EgressConfig cfg, Action<string> log)
{
    public Func<string, CancellationToken, Task<IPAddress[]>> Resolve { get; init; } = (h, ct) => Dns.GetHostAddressesAsync(h, ct);
    public Func<IPAddress, bool> MayReach { get; init; } = IsPublic;
    public int UpstreamPort { get; init; } = 443;
    public TimeSpan Wait { get; init; } = TimeSpan.FromSeconds(15);

    /// <summary>Set once the listener is bound: the port it took.</summary>
    public int Port { get; private set; }
    readonly TaskCompletionSource listening = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task Listening => listening.Task;
    readonly SemaphoreSlim slots = new(512);

    public async Task Run(CancellationToken stop)
    {
        var l = new TcpListener(cfg.Listen);
        l.Start(512);
        Port = ((IPEndPoint)l.LocalEndpoint).Port;
        log($"runner egress listening on {cfg.Listen.Address}:{Port}, {cfg.Allow.Count} host rule(s)");
        listening.TrySetResult();
        try
        {
            while (!stop.IsCancellationRequested)
            {
                TcpClient c;
                try { c = await l.AcceptTcpClientAsync(stop); }
                catch (OperationCanceledException) { break; }
                await slots.WaitAsync(stop);
                _ = Task.Run(async () =>
                {
                    try { await Serve(c, stop); }
                    finally { c.Dispose(); slots.Release(); }
                }, CancellationToken.None);
            }
        }
        finally { l.Stop(); }
    }

    async Task Serve(TcpClient client, CancellationToken stop)
    {
        var from = client.Client.RemoteEndPoint?.ToString() ?? "?";
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(stop);
        cts.CancelAfter(Wait);
        var cs = client.GetStream();
        try
        {
            var (head, rest) = await ReadHead(cs, cts.Token);
            if (head == null) { log($"{from}: REFUSED, no request head within {Wait.TotalSeconds:0} seconds or 8 KB"); return; }
            var parts = head.Split("\r\n", 2)[0].Split(' ');
            // A refusal is written down before the client hears it, so whoever
            // reads the answer finds the line already there (#5539).
            if (parts.Length != 3 || parts[0] != "CONNECT" || !parts[2].StartsWith("HTTP/1."))
            {
                log($"{from}: REFUSED {Clip(parts[0])}: only CONNECT to a listed host on port 443 goes out");
                await Answer(cs, "405 Method Not Allowed", cts.Token);
                return;
            }
            var target = parts[1];
            int colon = target.LastIndexOf(':');
            var host = colon > 0 ? HostRules.Normalize(target[..colon]) : null;
            if (host == null || target[(colon + 1)..] != "443" || !cfg.Allow.Allows(host))
            {
                log($"{from}: REFUSED {Clip(target)}: not a listed host on port 443");
                await Answer(cs, "403 Forbidden", cts.Token);
                return;
            }
            await Answer(cs, "200 Connection Established", cts.Token);

            // The ClientHello, whole, before anything leaves the box.
            var hello = new MemoryStream();
            hello.Write(rest);
            if (!await Fill(cs, hello, 5, cts.Token)) { log($"{from}: CLOSED {host}: no TLS after CONNECT"); return; }
            int need = TlsHello.RecordLength(hello.GetBuffer().AsSpan(0, 5));
            if (need < 0) { log($"{from}: CLOSED {host}: what came after CONNECT is not TLS"); return; }
            if (!await Fill(cs, hello, need, cts.Token)) { log($"{from}: CLOSED {host}: the ClientHello was cut short"); return; }
            var sni = TlsHello.ServerName(hello.GetBuffer().AsSpan(0, need));
            if (sni == null || HostRules.Normalize(sni) != host)
            {
                log($"{from}: CLOSED {host}: its ClientHello names {(sni == null ? "no host" : Clip(sni))}, not the host it asked for");
                return;
            }

            IPAddress[] all;
            try { all = await Resolve(host, cts.Token); }
            catch (SocketException e) { log($"{from}: CLOSED {host}: does not resolve ({e.SocketErrorCode})"); return; }
            var ok = all.Where(MayReach).ToArray();
            if (ok.Length == 0) { log($"{from}: CLOSED {host}: resolves only to addresses the proxy never goes to ({string.Join(", ", all.Select(a => a.ToString()))})"); return; }

            using var up = new TcpClient(ok[0].AddressFamily);
            IPAddress? went = null;
            foreach (var a in ok)
            {
                try
                {
                    if (up.Client.AddressFamily != a.AddressFamily) continue;
                    await up.ConnectAsync(a, UpstreamPort, cts.Token);
                    went = a;
                    break;
                }
                catch (SocketException) { }
            }
            if (went == null) { log($"{from}: CLOSED {host}: no address of it answered ({string.Join(", ", ok.Select(a => a.ToString()))})"); return; }
            var us = up.GetStream();
            await us.WriteAsync(hello.GetBuffer().AsMemory(0, (int)hello.Length), cts.Token);
            log($"{from}: {host} -> {went}");

            // From here the tunnel lasts as long as either side keeps it.
            cts.CancelAfter(Timeout.InfiniteTimeSpan);
            await Task.WhenAll(Pump(cs, us, up.Client, cts.Token), Pump(us, cs, client.Client, cts.Token));
        }
        catch (OperationCanceledException) when (!stop.IsCancellationRequested) { log($"{from}: CLOSED: nothing came within {Wait.TotalSeconds:0} seconds"); }
        catch (OperationCanceledException) { }
        catch (IOException e) { log($"{from}: CLOSED: {e.Message}"); }
        catch (SocketException e) { log($"{from}: CLOSED: {e.SocketErrorCode}"); }
    }

    static async Task Pump(Stream from, Stream to, Socket toSocket, CancellationToken ct)
    {
        var buf = new byte[64 * 1024];
        try
        {
            int n;
            while ((n = await from.ReadAsync(buf, ct)) > 0) await to.WriteAsync(buf.AsMemory(0, n), ct);
            // One side is done sending: the other may still answer.
            try { toSocket.Shutdown(SocketShutdown.Send); } catch (SocketException) { } catch (ObjectDisposedException) { }
        }
        // Either end going away ends this half; the other half sees it too.
        catch (IOException) { }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
    }

    static async Task<(string? Head, byte[] After)> ReadHead(Stream s, CancellationToken ct)
    {
        var buf = new byte[8192];
        int got = 0;
        while (got < buf.Length)
        {
            int n = await s.ReadAsync(buf.AsMemory(got), ct);
            if (n == 0) return (null, Array.Empty<byte>());
            got += n;
            int end = buf.AsSpan(0, got).IndexOf("\r\n\r\n"u8);
            if (end >= 0) return (Encoding.ASCII.GetString(buf, 0, end), buf[(end + 4)..got]);
        }
        return (null, Array.Empty<byte>());
    }

    static async Task<bool> Fill(Stream s, MemoryStream m, int need, CancellationToken ct)
    {
        var buf = new byte[4096];
        while (m.Length < need)
        {
            int n = await s.ReadAsync(buf.AsMemory(0, (int)Math.Min(buf.Length, need - m.Length)), ct);
            if (n == 0) return false;
            m.Write(buf, 0, n);
        }
        return true;
    }

    static Task Answer(Stream s, string status, CancellationToken ct) =>
        s.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 {status}\r\nContent-Length: 0\r\n\r\n"), ct).AsTask();

    static string Clip(string s) => s.Length > 80 ? s[..80] + "..." : s;

    /// <summary>An address on the internet: not loopback, private, shared,
    /// link-local, multicast or unspecified, in IPv4 or IPv6.</summary>
    public static bool IsPublic(IPAddress a)
    {
        if (a.IsIPv4MappedToIPv6) a = a.MapToIPv4();
        if (IPAddress.IsLoopback(a)) return false;
        var b = a.GetAddressBytes();
        if (a.AddressFamily == AddressFamily.InterNetwork)
        {
            return !(b[0] == 0 || b[0] == 10 || b[0] >= 224
                || (b[0] == 100 && b[1] >= 64 && b[1] < 128)
                || (b[0] == 169 && b[1] == 254)
                || (b[0] == 172 && b[1] >= 16 && b[1] < 32)
                || (b[0] == 192 && b[1] == 168));
        }
        if (a.AddressFamily == AddressFamily.InterNetworkV6)
        {
            return !(a.Equals(IPAddress.IPv6None) || a.IsIPv6LinkLocal || a.IsIPv6SiteLocal || a.IsIPv6Multicast
                || (b[0] & 0xfe) == 0xfc);
        }
        return false;
    }
}
