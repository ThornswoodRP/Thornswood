#nullable enable
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Thornswood.DeployAgent;

public sealed class Deployment
{
    [JsonPropertyName("id")] public long Id { get; set; }
    [JsonPropertyName("sha")] public string Sha { get; set; } = "";
    [JsonPropertyName("task")] public string Task { get; set; } = "";
    [JsonPropertyName("environment")] public string Environment { get; set; } = "";
    [JsonPropertyName("payload")] public JsonElement Payload { get; set; }
    [JsonPropertyName("creator")] public Login? Creator { get; set; }
    public sealed class Login { [JsonPropertyName("login")] public string Name { get; set; } = ""; }
}

public sealed class DeploymentStatus
{
    [JsonPropertyName("state")] public string State { get; set; } = "";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
}

/// <summary>A published Release. The tag lookup never returns a draft, so a
/// draft can never be deployed.</summary>
public sealed class WorkflowRun
{
    [JsonPropertyName("id")] public long Id { get; set; }
    [JsonPropertyName("path")] public string Path { get; set; } = "";
    [JsonPropertyName("head_branch")] public string HeadBranch { get; set; } = "";
    [JsonPropertyName("event")] public string Event { get; set; } = "";
}

public sealed class RunApproval
{
    [JsonPropertyName("state")] public string State { get; set; } = "";
    [JsonPropertyName("user")] public Deployment.Login? User { get; set; }
    [JsonPropertyName("environments")] public List<Named> Environments { get; set; } = new();
    public sealed class Named { [JsonPropertyName("name")] public string Name { get; set; } = ""; }
}

public sealed class Release
{
    [JsonPropertyName("tag_name")] public string TagName { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("body")] public string Body { get; set; } = "";
    [JsonPropertyName("html_url")] public string HtmlUrl { get; set; } = "";
    [JsonPropertyName("draft")] public bool Draft { get; set; }
    [JsonPropertyName("assets")] public List<Asset> Assets { get; set; } = new();
    public Asset? Asset(string name) => Assets.FirstOrDefault(a => a.Name == name);
}

public sealed class Asset
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("size")] public long Size { get; set; }
    [JsonPropertyName("url")] public string Url { get; set; } = "";
}

/// <summary>GitHub answered with something other than 2xx.</summary>
public sealed class GitHubException(string method, string path, int status, string message)
    : Exception($"{method} {path}: HTTP {status}" + (message == "" ? "" : ": " + message))
{
    public int Status { get; } = status;
}

/// <summary>Hands out the bearer token for GitHub calls; "" asks with none.</summary>
public interface ITokenSource { Task<string> TokenAsync(CancellationToken ct); }

public sealed class StaticToken(string token) : ITokenSource
{
    public Task<string> TokenAsync(CancellationToken ct) => Task.FromResult(token);
}

/// <summary>The few REST calls the agent makes. Every call goes out from the box.</summary>
public sealed class GitHub(string api, string repo, ITokenSource tokens, HttpClient http)
{
    public string Repo => repo;
    public ITokenSource Tokens => tokens;
    string RepoPath => "/repos/" + repo;

    async Task<HttpRequestMessage> Request(HttpMethod method, string urlOrPath, string accept, CancellationToken ct)
    {
        var url = urlOrPath.StartsWith("http") ? urlOrPath : api.TrimEnd('/') + urlOrPath;
        var req = new HttpRequestMessage(method, url);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(accept));
        req.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        req.Headers.UserAgent.ParseAdd("thornswood-deploy-agent");
        var tok = await tokens.TokenAsync(ct);
        if (tok != "") req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tok);
        return req;
    }

    async Task<T> Call<T>(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var req = await Request(method, path, "application/vnd.github+json", ct);
        if (body != null) req.Content = JsonContent.Create(body);
        using var res = await http.SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            string msg = "";
            try { using var d = JsonDocument.Parse(text); if (d.RootElement.TryGetProperty("message", out var m)) msg = m.GetString() ?? ""; } catch (JsonException) { }
            throw new GitHubException(method.Method, path, (int)res.StatusCode, msg);
        }
        if (typeof(T) == typeof(bool)) return (T)(object)true;
        return JsonSerializer.Deserialize<T>(text) ?? throw new InvalidDataException($"{method} {path}: the answer is empty");
    }

    /// <summary>The newest Deployments to one environment, newest first.</summary>
    public Task<List<Deployment>> Deployments(string env, int n, CancellationToken ct) =>
        Call<List<Deployment>>(HttpMethod.Get, $"{RepoPath}/deployments?environment={Uri.EscapeDataString(env)}&per_page={n}", null, ct);

    public Task<List<DeploymentStatus>> Statuses(long id, CancellationToken ct) =>
        Call<List<DeploymentStatus>>(HttpMethod.Get, $"{RepoPath}/deployments/{id}/statuses?per_page=10", null, ct);

    /// <summary>Puts a status on a Deployment. GitHub keeps 140 characters of
    /// the description, so the line is cut there and the whole story is in the
    /// log the log URL names.</summary>
    public Task SetStatus(long id, string state, string description, string logUrl, CancellationToken ct)
    {
        if (description.Length > 140) description = description[..137] + "...";
        var body = new Dictionary<string, object> { ["state"] = state, ["description"] = description };
        if (logUrl != "") body["log_url"] = logUrl;
        // The Deployment before this one is no longer what runs there.
        if (state == "success") body["auto_inactive"] = true;
        return Call<bool>(HttpMethod.Post, $"{RepoPath}/deployments/{id}/statuses", body, ct);
    }

    /// <summary>One workflow run: which workflow, on which branch, started how.</summary>
    public Task<WorkflowRun> Run(long id, CancellationToken ct) =>
        Call<WorkflowRun>(HttpMethod.Get, $"{RepoPath}/actions/runs/{id}", null, ct);

    /// <summary>Who approved or rejected a run's wait on an environment's
    /// required reviewers (#5181). Needs Actions: read.</summary>
    public Task<List<RunApproval>> RunApprovals(long id, CancellationToken ct) =>
        Call<List<RunApproval>>(HttpMethod.Get, $"{RepoPath}/actions/runs/{id}/approvals", null, ct);

    public Task<Release> ReleaseByTag(string tag, CancellationToken ct) =>
        Call<Release>(HttpMethod.Get, $"{RepoPath}/releases/tags/{Uri.EscapeDataString(tag)}", null, ct);

    /// <summary>The paths a compare of two commits names, or null when GitHub
    /// says it cut the list short (300 files) or knows no such commit, so the
    /// caller treats every path as changed.</summary>
    public async Task<List<string>?> ChangedPaths(string from, string to, CancellationToken ct)
    {
        Compare c;
        try { c = await Call<Compare>(HttpMethod.Get, $"{RepoPath}/compare/{Uri.EscapeDataString(from)}...{Uri.EscapeDataString(to)}", null, ct); }
        catch (GitHubException e) when (e.Status is 404 or 422) { return null; }
        if (c.Files == null || c.Files.Count >= 300) return null;
        return c.Files.SelectMany(f => new[] { f.Name, f.Previous ?? "" }).Where(n => n != "").ToList();
    }

    sealed class Compare { [JsonPropertyName("files")] public List<CompareFile>? Files { get; set; } }
    sealed class CompareFile
    {
        [JsonPropertyName("filename")] public string Name { get; set; } = "";
        [JsonPropertyName("previous_filename")] public string? Previous { get; set; }
    }

    /// <summary>The titles of the open issues that carry a label.</summary>
    public async Task<List<string>> OpenIssueTitles(string label, CancellationToken ct)
    {
        var got = await Call<List<Issue>>(HttpMethod.Get, $"{RepoPath}/issues?state=open&labels={Uri.EscapeDataString(label)}&per_page=100", null, ct);
        return got.Select(i => i.Title).ToList();
    }

    /// <summary>Makes the label when the repository has none by that name.</summary>
    public async Task EnsureLabel(string name, string color, string description, CancellationToken ct)
    {
        try { await Call<bool>(HttpMethod.Post, $"{RepoPath}/labels", new Dictionary<string, object> { ["name"] = name, ["color"] = color, ["description"] = description }, ct); }
        // 422 is GitHub saying a label by that name is there already.
        catch (GitHubException e) when (e.Status == 422) { return; }
    }

    public Task OpenIssue(string title, string body, string label, CancellationToken ct) =>
        Call<bool>(HttpMethod.Post, $"{RepoPath}/issues", new Dictionary<string, object> { ["title"] = title, ["body"] = body, ["labels"] = new[] { label } }, ct);

    sealed class Issue { [JsonPropertyName("title")] public string Title { get; set; } = ""; }

    /// <summary>The names of every tag that starts with prefix. GitHub's list
    /// of Releases is a page of them in its own order (a Release's created_at
    /// is its commit's date, so one made today can sit far down), so the
    /// newest of a kind is found from the tags, all of them, and then fetched
    /// by its tag.</summary>
    public async Task<List<string>> TagNames(string prefix, CancellationToken ct)
    {
        var refs = await Call<List<Ref>>(HttpMethod.Get, $"{RepoPath}/git/matching-refs/tags/{Uri.EscapeDataString(prefix)}", null, ct);
        return refs.Select(r => r.Name).Where(n => n.StartsWith("refs/tags/", StringComparison.Ordinal)).Select(n => n["refs/tags/".Length..]).ToList();
    }

    sealed class Ref { [JsonPropertyName("ref")] public string Name { get; set; } = ""; }

    /// <summary>Saves one asset to a file, refusing more bytes than the asset
    /// says it has. GitHub answers with a redirect to its file store, and
    /// HttpClient drops the Authorization header when a redirect leaves the
    /// host, so the token never goes there.</summary>
    public async Task Download(Asset a, string to, CancellationToken ct)
    {
        using var req = await Request(HttpMethod.Get, a.Url, "application/octet-stream", ct);
        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (res.StatusCode != HttpStatusCode.OK) throw new IOException($"downloading {a.Name}: HTTP {(int)res.StatusCode}");
        await using var src = await res.Content.ReadAsStreamAsync(ct);
        await using (var dst = File.Create(to))
        {
            var buf = new byte[81920];
            long total = 0;
            int n;
            while ((n = await src.ReadAsync(buf, ct)) > 0)
            {
                total += n;
                if (total > a.Size) throw new IOException($"downloading {a.Name}: more than the {a.Size} bytes the Release says");
                await dst.WriteAsync(buf.AsMemory(0, n), ct);
            }
            if (total != a.Size) throw new IOException($"downloading {a.Name}: got {total} bytes, the Release says {a.Size}");
        }
    }
}

/// <summary>Installation tokens of the box admin App, whose key already lives
/// on the box and nowhere else (scripts/vps/admin/admin.js, #3107). Each is
/// asked for with only what the agent needs, on the one repository it reads,
/// so it can do nothing else even though the App can. GitHub ends it after
/// an hour, and it is kept in memory only.</summary>
public sealed class AppTokens(string api, string repo, string stateDir, HttpClient http, Func<DateTimeOffset>? now = null, IReadOnlyDictionary<string, string>? permissions = null) : ITokenSource
{
    /// <summary>All the service asks of the App: Releases to read, and
    /// Deployments to read and say how they went.</summary>
    public static readonly IReadOnlyDictionary<string, string> Permissions =
        new SortedDictionary<string, string> { ["contents"] = "read", ["deployments"] = "write" };

    /// <summary>All a deploy by tag (the gate's Deploy-Release) asks: Releases
    /// to read. It reports on no Deployment, so it works before the App holds
    /// Deployments.</summary>
    /// <summary>The service with main to look after (#5181): also Actions to
    /// read, for who approved the run behind each Main Deployment. Asked only
    /// then, so dev keeps working on an App that does not hold it.</summary>
    public static readonly IReadOnlyDictionary<string, string> WithApprovals =
        new SortedDictionary<string, string> { ["actions"] = "read", ["contents"] = "read", ["deployments"] = "write" };

    public static readonly IReadOnlyDictionary<string, string> ReleasesOnly =
        new SortedDictionary<string, string> { ["contents"] = "read" };

    /// <summary>What filing the parity check's rows asks (#5180): issues to
    /// read and open, and nothing else, minted apart from the service's own
    /// token so an App without Issues write costs only the filing.</summary>
    public static readonly IReadOnlyDictionary<string, string> IssuesWrite =
        new SortedDictionary<string, string> { ["issues"] = "write" };

    readonly IReadOnlyDictionary<string, string> asks = permissions ?? Permissions;

    readonly SemaphoreSlim gate = new(1, 1);
    string token = "";
    DateTimeOffset expires;
    DateTimeOffset Now => now?.Invoke() ?? DateTimeOffset.UtcNow;

    public async Task<string> TokenAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (token != "" && Now.AddMinutes(5) < expires) return token;
            (token, expires) = await Mint(ct);
            return token;
        }
        finally { gate.Release(); }
    }

    async Task<(string, DateTimeOffset)> Mint(CancellationToken ct)
    {
        var appPath = Path.Combine(stateDir, "app.json");
        var keyPath = Path.Combine(stateDir, "key.pem");
        if (!File.Exists(appPath) || !File.Exists(keyPath))
            throw new InvalidOperationException($"the box admin App is not set up here: there is no {appPath} and {keyPath} (Install-AdminService.ps1 -Setup makes them)");
        string appId;
        using (var d = JsonDocument.Parse(File.ReadAllText(appPath)))
        {
            var id = d.RootElement.GetProperty("id");
            appId = id.ValueKind == JsonValueKind.Number ? id.GetRawText() : id.GetString() ?? "";
        }
        if (appId == "") throw new InvalidOperationException($"{appPath} names no App id");
        var jwt = AppJwt(appId, File.ReadAllText(keyPath), Now);
        var baseUrl = api.TrimEnd('/');
        using var inst = await Send(HttpMethod.Get, $"{baseUrl}/repos/{repo}/installation", jwt, null, ct);
        var instId = inst.RootElement.GetProperty("id").GetInt64();
        var name = repo.Split('/')[1];
        try
        {
            using var tok = await Send(HttpMethod.Post, $"{baseUrl}/app/installations/{instId}/access_tokens", jwt,
                new { repositories = new[] { name }, permissions = asks }, ct);
            return (tok.RootElement.GetProperty("token").GetString() ?? "", tok.RootElement.GetProperty("expires_at").GetDateTimeOffset());
        }
        catch (GitHubException e) when (e.Status == 422)
        {
            var what = string.Join(" and ", asks.Select(kv => $"{kv.Key} {kv.Value}"));
            throw new InvalidOperationException($"GitHub gave the box admin App no token with {what} on {repo} ({e.Message}). " +
                (asks.ContainsKey("deployments")
                    ? "The App takes Deployments only once Deployments: Read and write is added on its permissions page and accepted on its installation."
                    : "The App's installation has to include this repository."));
        }
    }

    async Task<JsonDocument> Send(HttpMethod method, string url, string jwt, object? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, url);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        req.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        req.Headers.UserAgent.ParseAdd("thornswood-deploy-agent");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        if (body != null) req.Content = JsonContent.Create(body);
        using var res = await http.SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            string msg = "";
            try { using var d = JsonDocument.Parse(text); if (d.RootElement.TryGetProperty("message", out var m)) msg = m.GetString() ?? ""; } catch (JsonException) { }
            throw new GitHubException(method.Method, new Uri(url).AbsolutePath, (int)res.StatusCode, msg);
        }
        return JsonDocument.Parse(text);
    }

    /// <summary>The App's own ten minute token, made the way admin.js appJwt
    /// makes it: RS256, issued a minute back for clock drift, nine minutes on.</summary>
    public static string AppJwt(string appId, string keyPem, DateTimeOffset now)
    {
        using var rsa = RSA.Create();
        rsa.ImportFromPem(keyPem);
        static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var head = B64(Encoding.UTF8.GetBytes("{\"alg\":\"RS256\",\"typ\":\"JWT\"}"));
        var claims = B64(JsonSerializer.SerializeToUtf8Bytes(new { iat = now.ToUnixTimeSeconds() - 60, exp = now.ToUnixTimeSeconds() + 540, iss = appId }));
        var sig = rsa.SignData(Encoding.ASCII.GetBytes(head + "." + claims), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return head + "." + claims + "." + B64(sig);
    }
}
