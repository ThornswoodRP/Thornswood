using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Thornswood.DeployAgent;
using Xunit;

namespace Thornswood.DeployAgent.Tests;

/// <summary>A stand-in for the site's task and the bot's service. The site
/// answers its front page while it runs, with 500 when its server.js says
/// BROKEN. The bot writes to its log as it starts: "watching 1 server", or
/// "stopped within" when its bot.py says BROKEN, or nothing when it says
/// SILENT. Voice answers /health at voice.test with the build its
/// voice-server.js named when it was started, and a voice-server.js that
/// says DEAD never starts, so the copy before it goes on answering.</summary>
sealed class FakeAppControl(string root) : IAppControl
{
    public bool Up = true;
    public string RunningBuild = "";
    public int Stops, Starts, Libs;
    public string Missing = "";
    public string LibsSay = "";
    public bool Stuck;
    public readonly List<string> Parsed = new();

    public string NotInstalled(EnvConfig e) => Missing;

    public StopResult Stop(EnvConfig e, TimeSpan within)
    {
        Stops++;
        Up = false;
        return new StopResult(["stopped it"], Stuck ? ["pid 42 was ended and had not exited after 30 seconds"] : []);
    }

    public void Start(EnvConfig e)
    {
        Starts++;
        Up = true;
        if (e.Kind == AppKinds.Voice)
        {
            var vs = Path.Combine(root, "voice-server.js");
            if (!File.ReadAllText(vs).Contains("DEAD")) RunningBuild = App.BuildOf(vs);
            return;
        }
        if (e.Kind != AppKinds.Discord) return;
        var bot = File.ReadAllText(Path.Combine(root, "bot.py"));
        if (bot.Contains("SILENT")) return;
        var log = Path.Combine(root, "data", "bot.log");
        File.AppendAllText(log, bot.Contains("BROKEN") ? "[service] python stopped within 1 second\n" : "[thornswood-bot] watching 1 server\n");
    }

    public bool Running(EnvConfig e) => Up;

    public string Parse(EnvConfig e, string path)
    {
        Parsed.Add(Path.GetFileName(path));
        return File.ReadAllText(path).Contains("SYNTAX") ? "SyntaxError: Unexpected token" : "";
    }

    public string Libraries(EnvConfig e, string requirements, string dir, string trustPy)
    {
        Libs++;
        if (LibsSay != "") return LibsSay;
        File.WriteAllText(Path.Combine(dir, "discord.py"), File.ReadAllText(requirements));
        return "";
    }

    public HttpResponseMessage Health(HttpRequestMessage r)
    {
        if (!Up) throw new HttpRequestException("connection refused");
        if (r.RequestUri!.Host == "voice.test")
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new { ok = true, build = RunningBuild })) };
        var broken = File.ReadAllText(Path.Combine(root, "server.js")).Contains("BROKEN");
        return new HttpResponseMessage(broken ? HttpStatusCode.InternalServerError : HttpStatusCode.OK);
    }
}

public sealed class AppTests : IDisposable
{
    const string Commit = "0123456789abcdef0123456789abcdef01234567";
    readonly List<string> temp = new();
    readonly List<string> said = new();

    string Temp()
    {
        var d = Directory.CreateTempSubdirectory("tw-app-").FullName;
        temp.Add(d);
        return d;
    }

    public void Dispose()
    {
        foreach (var d in temp) try { Directory.Delete(d, true); } catch (IOException) { }
    }

    static byte[] B(string s) => Encoding.UTF8.GetBytes(s);
    static string Sha(byte[] b) => Convert.ToHexStringLower(SHA256.HashData(b));

    /// <summary>An app's zip as App-Part.ps1 makes it: plain paths, sorted.</summary>
    static byte[] Zip(Dictionary<string, string> files)
    {
        using var ms = new MemoryStream();
        using (var za = new ZipArchive(ms, ZipArchiveMode.Create, true))
            foreach (var (n, t) in files.OrderBy(kv => kv.Key, StringComparer.Ordinal))
                using (var e = za.CreateEntry(n).Open()) e.Write(B(t));
        return ms.ToArray();
    }

    static void AppRelease(FakeGitHub gh, string tag, string part, byte[] zip, string commit = Commit)
    {
        var m = new Manifest { Schema = 1, Repo = "O/R", Commit = commit, Tag = tag };
        m.Parts[part] = [new ManifestFile { Name = part + ".zip", Sha256 = Sha(zip), Size = zip.Length }];
        var mb = JsonSerializer.SerializeToUtf8Bytes(m);
        gh.AddRelease(tag, new() { [part + ".zip"] = zip, ["manifest.json"] = mb, ["manifest.cat"] = B(Sha(mb)) });
    }

    static void Put(string root, Dictionary<string, string> files)
    {
        foreach (var (rel, t) in files)
        {
            var p = Path.Combine([root, .. rel.Split('/')]);
            Directory.CreateDirectory(Path.GetDirectoryName(p)!);
            File.WriteAllText(p, t);
        }
    }

    static string Read(string root, string rel) => File.ReadAllText(Path.Combine([root, .. rel.Split('/')]));
    static bool Has(string root, string rel) => File.Exists(Path.Combine([root, .. rel.Split('/')]));

    sealed record Rig(Agent Agent, FakeGitHub Gh, FakeAppControl Control, EnvConfig Env, string Root, string Store, string Logs, Config Cfg);

    Rig Make(string kind)
    {
        var gh = new FakeGitHub();
        var root = Temp();
        var control = new FakeAppControl(root);
        gh.Other = control.Health;
        var http = new HttpClient(gh);
        var home = Temp();
        var env = kind == AppKinds.Site ? Config.DefaultSite() : Config.DefaultDiscord();
        env.Root = root;
        env.Store = Path.Combine(home, "store");
        env.Watch = Temp();
        Directory.CreateDirectory(Path.Combine(env.Watch, "holds"));
        env.Health = "https://site.test/";
        env.WaitSeconds = 1;
        env.LogDir = Path.Combine(home, "logs-out");
        env.LogBase = "http://box.test:7788/";
        var cfg = new Config { Repo = "O/R", Api = FakeGitHub.Api, Home = home, Environments = { [kind] = env } };
        var app = new App(env, http, control) { Tick = TimeSpan.FromMilliseconds(5) };
        var gh2 = new GitHub(FakeGitHub.Api, "O/R", new StaticToken("t"), http);
        var a = new Agent(cfg, gh2, new FakeVerifier(), new(), "1.0.0", "", l => { lock (said) said.Add(l); }) { Host = "box", Apps = { [kind] = app } };
        return new Rig(a, gh, control, env, root, env.Store, env.LogDir, cfg);
    }

    static string LastSaid(FakeGitHub gh, long id) => (string)gh.Last(id)!["description"]!;

    void States(Rig r, long id, string want)
    {
        var got = string.Join(",", r.Gh.States(id));
        if (got == want) return;
        var log = Path.Combine(r.Logs, $"deploy-{id}.log");
        Assert.Fail($"Deployment {id}: expected {want}, got {got}: {(string?)r.Gh.Last(id)?["description"]}\n" + (File.Exists(log) ? File.ReadAllText(log) : string.Join("\n", said)));
    }

    // ---- the site ----------------------------------------------------------

    static readonly Dictionary<string, string> SiteNow = new()
    {
        ["server.js"] = "// site v1",
        ["public/home.css"] = "body{}",
        ["public/looks.css"] = "gone soon",
        ["public/downloads/Thornswood-Setup.exe"] = "MZ",
        ["data/site/rules.md"] = "# Rules",
        ["data/site/old.md"] = "# Old page",
        ["lib/serve.js"] = "// serve v1",
        ["lib/dropped.js"] = "// a module the site no longer has",
        ["data/board.json"] = "{\"typed\":true}",
        ["data/help.md"] = "typed on the site",
    };

    /// <summary>#5190: each environment has its own loop, so a site change
    /// goes in while another environment's pass is still running (dev's bot
    /// pass takes up to half an hour). Here the Discord bot's pass is held at
    /// its first question to GitHub for as long as the test likes; with one
    /// loop for every environment, discord comes before site and the site
    /// Deployment would wait behind it (build-20261102.2, 1 Nov).</summary>
    [Fact]
    public async Task ASiteDeploymentGoesInWhileAnotherEnvironmentIsStillBusy()
    {
        var r = Make(AppKinds.Site);
        r.Cfg.Environments[AppKinds.Discord] = Config.DefaultDiscord();
        Put(r.Root, SiteNow);
        AppRelease(r.Gh, "build-1", "site", Zip(new() { ["server.js"] = "// site v2", ["public/home.css"] = "body{}" }));
        var held = new TaskCompletionSource();
        var busy = new TaskCompletionSource();
        var discordEnv = r.Cfg.Environments[AppKinds.Discord].GitHubEnvironment;
        r.Gh.BeforeDeployments = e => { if (e != discordEnv) return Task.CompletedTask; busy.TrySetResult(); return held.Task; };
        var id = r.Gh.AddDeployment("Site", Commit, "{\"release\":\"build-1\",\"part\":\"site\"}");
        using var cts = new CancellationTokenSource();
        var run = r.Agent.Run(cts.Token);
        await busy.Task.WaitAsync(TimeSpan.FromSeconds(10));
        var until = DateTime.UtcNow.AddSeconds(20);
        while ((string?)r.Gh.Last(id)?["state"] != "success" && DateTime.UtcNow < until) await Task.Delay(20);
        var stillHeld = !held.Task.IsCompleted;
        cts.Cancel();
        held.TrySetResult();
        await run;
        Assert.True(stillHeld);
        States(r, id, "in_progress,success");
        Assert.Equal("// site v2", Read(r.Root, "server.js"));
    }

    [Fact]
    public async Task ASiteDeploymentSwapsInWhatChangedAndTakesOutWhatLeft()
    {
        var r = Make(AppKinds.Site);
        Put(r.Root, SiteNow);
        AppRelease(r.Gh, "build-1", "site", Zip(new()
        {
            ["server.js"] = "// site v2",
            ["public/home.css"] = "body{}",
            ["public/hub.js"] = "let x = 1",
            ["data/site/rules.md"] = "# Rules, new",
            ["lib/serve.js"] = "// serve v2",
            ["lib/news.js"] = "// news",
        }));
        var id = r.Gh.AddDeployment("Site", Commit, "{\"release\":\"build-1\",\"part\":\"site\"}");
        await r.Agent.Pass(AppKinds.Site, CancellationToken.None);
        States(r, id, "in_progress,success");
        Assert.Equal("// site v2", Read(r.Root, "server.js"));
        Assert.Equal("let x = 1", Read(r.Root, "public/hub.js"));
        Assert.Equal("# Rules, new", Read(r.Root, "data/site/rules.md"));
        // The program's modules (#5357) come with it, and one it dropped goes.
        Assert.Equal("// serve v2", Read(r.Root, "lib/serve.js"));
        Assert.Equal("// news", Read(r.Root, "lib/news.js"));
        Assert.False(Has(r.Root, "lib/dropped.js"));
        // What the Release no longer has goes aside; what the site writes and
        // the folders other scripts fill are never touched.
        Assert.False(Has(r.Root, "public/looks.css"));
        Assert.False(Has(r.Root, "data/site/old.md"));
        Assert.Equal("MZ", Read(r.Root, "public/downloads/Thornswood-Setup.exe"));
        Assert.Equal("{\"typed\":true}", Read(r.Root, "data/board.json"));
        Assert.Equal("typed on the site", Read(r.Root, "data/help.md"));
        var prev = Directory.GetDirectories(r.Root, ".prev-*").Single();
        Assert.Equal("// site v1", Read(prev, "server.js"));
        Assert.Equal("gone soon", Read(prev, "public/looks.css"));
        Assert.Equal("// a module the site no longer has", Read(prev, "lib/dropped.js"));
        Assert.False(Has(prev, "public/home.css"));
        Assert.Empty(Directory.GetDirectories(r.Root, ".agent-stage-*"));
        Assert.Equal((1, 1), (r.Control.Stops, r.Control.Starts));
        Assert.Contains("server.js", r.Control.Parsed);
        Assert.Contains("serve.js", r.Control.Parsed);
        Assert.Contains("news.js", r.Control.Parsed);
        Assert.DoesNotContain("hub.js", r.Control.Parsed);
        // The record, beside the site and in the store, and the log where the outside reads it.
        using var rec = JsonDocument.Parse(File.ReadAllText(Path.Combine(r.Root, "thornswood-deploy.json")));
        Assert.Equal(("build-1", Commit, "site"), (rec.RootElement.GetProperty("name").GetString(), rec.RootElement.GetProperty("commit").GetString(), rec.RootElement.GetProperty("component").GetString()));
        Assert.True(File.Exists(Path.Combine(r.Store, "current", Records.PartName(r.Root) + ".json")));
        Assert.Equal($"http://box.test:7788/deploy-{id}.log", (string)r.Gh.Last(id)!["log_url"]!);
        Assert.True(File.Exists(Path.Combine(r.Logs, $"deploy-{id}.log")));
        Assert.Empty(Directory.GetFiles(Path.Combine(r.Env.Watch, "holds")));
    }

    [Fact]
    public void TwoSwapsInOneSecondGetFoldersOfTheirOwn()
    {
        var root = Temp();
        var now = new DateTime(2026, 11, 1, 19, 49, 26);
        Assert.Equal("20261101-194926", Swap.FreeStamp(root, now));
        Directory.CreateDirectory(Path.Combine(root, ".prev-20261101-194926"));
        Assert.Equal("20261101-194926-2", Swap.FreeStamp(root, now));
        Directory.CreateDirectory(Path.Combine(root, ".undone-20261101-194926-2"));
        Assert.Equal("20261101-194926-3", Swap.FreeStamp(root, now));
        // The newest is still the last by name, which is how the old ones are pruned.
        Assert.True(string.CompareOrdinal("20261101-194926-3", "20261101-194926") > 0);
    }

    // ---- the news the bot posts (#5187) -------------------------------------

    [Fact]
    public async Task ADeploymentThatWentInLeavesItsReleaseNewsForTheBot()
    {
        var r = Make(AppKinds.Site);
        Directory.CreateDirectory(Path.Combine(r.Store, News.Folder));
        Put(r.Root, new() { ["server.js"] = "// v1" });
        AppRelease(r.Gh, "build-3", "site", Zip(new() { ["server.js"] = "// v2" }));
        r.Gh.Releases["build-3"]["name"] = "The forge lists each ingot once";
        r.Gh.Releases["build-3"]["body"] = "- The forge lists each ingot once.";
        r.Gh.Releases["build-3"]["html_url"] = "https://github.test/O/R/releases/tag/build-3";
        var id = r.Gh.AddDeployment("Site", Commit, "{\"release\":\"build-3\",\"part\":\"site\"}");
        await r.Agent.Pass(AppKinds.Site, CancellationToken.None);
        States(r, id, "in_progress,success");
        using var doc = JsonDocument.Parse(File.ReadAllText(News.FileFor(r.Store, AppKinds.Site)));
        var e = doc.RootElement;
        Assert.Equal(("site", "build-3", "The forge lists each ingot once", "- The forge lists each ingot once.", Commit),
            (e.GetProperty("environment").GetString(), e.GetProperty("tag").GetString(), e.GetProperty("name").GetString(),
             e.GetProperty("body").GetString(), e.GetProperty("commit").GetString()));
        Assert.Equal("https://github.test/O/R/releases/tag/build-3", e.GetProperty("url").GetString());
    }

    [Fact]
    public async Task NoNewsIsLeftForAFailureARollbackOrABoxWithNoBot()
    {
        var r = Make(AppKinds.Site);
        var news = News.FileFor(r.Store, AppKinds.Site);
        Directory.CreateDirectory(Path.GetDirectoryName(news)!);
        Put(r.Root, new() { ["server.js"] = "// v1" });
        AppRelease(r.Gh, "build-4", "site", Zip(new() { ["server.js"] = "// BROKEN" }));
        var id = r.Gh.AddDeployment("Site", Commit, "{\"release\":\"build-4\",\"part\":\"site\"}");
        await r.Agent.Pass(AppKinds.Site, CancellationToken.None);
        States(r, id, "in_progress,failure");
        Assert.False(File.Exists(news));
        // A rollback by tag is not news.
        AppRelease(r.Gh, "build-5", "site", Zip(new() { ["server.js"] = "// v5" }));
        Assert.Equal("success", (await r.Agent.DeployTag(AppKinds.Site, "build-5", CancellationToken.None)).State);
        Assert.False(File.Exists(news));
        // No for-bot folder: the Deployment still goes in, and the log says why there is no news.
        Directory.Delete(Path.GetDirectoryName(news)!);
        AppRelease(r.Gh, "build-6", "site", Zip(new() { ["server.js"] = "// v6" }));
        var id2 = r.Gh.AddDeployment("Site", Commit, "{\"release\":\"build-6\",\"part\":\"site\"}");
        await r.Agent.Pass(AppKinds.Site, CancellationToken.None);
        States(r, id2, "in_progress,success");
        lock (said) Assert.Contains(said, l => l.Contains("no news left for the bot"));
    }

    [Fact]
    public async Task ASiteThatAlreadyHasEveryFileIsNotStopped()
    {
        var r = Make(AppKinds.Site);
        Put(r.Root, new() { ["server.js"] = "// v1", ["public/a.css"] = "a" });
        AppRelease(r.Gh, "build-1", "site", Zip(new() { ["server.js"] = "// v1", ["public/a.css"] = "a" }));
        var o = await r.Agent.DeployTag(AppKinds.Site, "build-1", CancellationToken.None);
        Assert.Equal("success", o.State);
        Assert.Contains("was not stopped", o.Summary);
        Assert.Equal((0, 0), (r.Control.Stops, r.Control.Starts));
        Assert.True(File.Exists(Path.Combine(r.Root, "thornswood-deploy.json")));
    }

    [Fact]
    public async Task ASiteThatDoesNotAnswerIsPutBackWithWhatLeft()
    {
        var r = Make(AppKinds.Site);
        Put(r.Root, new() { ["server.js"] = "// v1", ["public/a.css"] = "a", ["public/old.css"] = "old" });
        AppRelease(r.Gh, "build-2", "site", Zip(new() { ["server.js"] = "// BROKEN v2", ["public/a.css"] = "a2" }));
        var id = r.Gh.AddDeployment("Site", Commit, "{\"release\":\"build-2\",\"part\":\"site\"}");
        await r.Agent.Pass(AppKinds.Site, CancellationToken.None);
        States(r, id, "in_progress,failure");
        Assert.Contains("the previous site is back and answering", LastSaid(r.Gh, id));
        Assert.Equal("// v1", Read(r.Root, "server.js"));
        Assert.Equal("a", Read(r.Root, "public/a.css"));
        Assert.Equal("old", Read(r.Root, "public/old.css"));
        Assert.Empty(Directory.GetDirectories(r.Root, ".prev-*"));
        Assert.Empty(Directory.GetDirectories(r.Root, ".agent-stage-*"));
        Assert.Equal((2, 2), (r.Control.Stops, r.Control.Starts));
        Assert.False(File.Exists(Path.Combine(r.Root, "thornswood-deploy.json")));
        Assert.Empty(Directory.GetFiles(Path.Combine(r.Env.Watch, "holds")));
    }

    [Theory]
    [InlineData("server.js", "// SYNTAX", "server.js does not parse")]
    [InlineData("lib/serve.js", "// SYNTAX", "lib/serve.js does not parse")]
    [InlineData("lib/deeper/x.js", "x", "not one of the site's files a Release may carry")]
    [InlineData("lib/notes.txt", "x", "not one of the site's files a Release may carry")]
    [InlineData("data/site/pages.json", "{nope", "data/site/pages.json does not parse")]
    [InlineData("data/board.json", "{}", "not one of the site's files a Release may carry")]
    [InlineData("public/downloads/x.exe", "MZ", "not one of the site's files a Release may carry")]
    [InlineData("../server.js", "x", "not a plain path")]
    [InlineData(".env", "x", "not a plain path")]
    public async Task ASiteReleaseIsRefusedBeforeAnythingStops(string rel, string text, string want)
    {
        var r = Make(AppKinds.Site);
        Put(r.Root, new() { ["server.js"] = "// v1" });
        var files = new Dictionary<string, string> { ["server.js"] = "// v2" };
        files[rel] = text;
        AppRelease(r.Gh, "build-3", "site", Zip(files));
        var o = await r.Agent.DeployTag(AppKinds.Site, "build-3", CancellationToken.None);
        Assert.Equal("failure", o.State);
        Assert.Contains(want, o.Summary);
        Assert.Equal((0, 0), (r.Control.Stops, r.Control.Starts));
        Assert.Equal("// v1", Read(r.Root, "server.js"));
        Assert.Empty(Directory.GetDirectories(r.Root, ".agent-stage-*"));
    }

    [Fact]
    public async Task AStopThatLeavesAProcessMovesNothing()
    {
        var r = Make(AppKinds.Site);
        Put(r.Root, new() { ["server.js"] = "// v1" });
        r.Control.Stuck = true;
        AppRelease(r.Gh, "build-4", "site", Zip(new() { ["server.js"] = "// v2" }));
        var o = await r.Agent.DeployTag(AppKinds.Site, "build-4", CancellationToken.None);
        Assert.Equal("failure", o.State);
        Assert.Equal("// v1", Read(r.Root, "server.js"));
        Assert.True(r.Control.Up);
    }

    [Fact]
    public async Task ASiteNotSetUpYetIsRefused()
    {
        var r = Make(AppKinds.Site);
        r.Control.Missing = "the task Thornswood Docs is not on this box";
        AppRelease(r.Gh, "build-5", "site", Zip(new() { ["server.js"] = "// v2" }));
        var o = await r.Agent.DeployTag(AppKinds.Site, "build-5", CancellationToken.None);
        Assert.Equal("failure", o.State);
        Assert.Contains("Thornswood Docs is not on this box", o.Summary);
    }

    [Theory]
    [InlineData("{\"release\":\"build-6\",\"part\":\"discord\"}", "asks for the discord part")]
    [InlineData("{\"release\":\"build-6\",\"part\":\"site\"}", "is not the one file site.zip")]
    public async Task ADeploymentForAnotherPartIsRefused(string payload, string want)
    {
        var r = Make(AppKinds.Site);
        Put(r.Root, new() { ["server.js"] = "// v1" });
        var m = new Manifest { Schema = 1, Repo = "O/R", Commit = Commit, Tag = "build-6" };
        var z = Zip(new() { ["server.js"] = "// v2" });
        m.Parts["site"] = [new ManifestFile { Name = "site.zip", Sha256 = Sha(z), Size = z.Length }, new ManifestFile { Name = "other.zip", Sha256 = Sha(z), Size = z.Length }];
        var mb = JsonSerializer.SerializeToUtf8Bytes(m);
        r.Gh.AddRelease("build-6", new() { ["site.zip"] = z, ["other.zip"] = z, ["manifest.json"] = mb, ["manifest.cat"] = B(Sha(mb)) });
        var id = r.Gh.AddDeployment("Site", Commit, payload);
        await r.Agent.Pass(AppKinds.Site, CancellationToken.None);
        States(r, id, "in_progress,failure");
        Assert.Contains(want, LastSaid(r.Gh, id));
        Assert.Equal("// v1", Read(r.Root, "server.js"));
    }

    // ---- the Discord bot ---------------------------------------------------

    static Dictionary<string, string> BotFiles(string bot = "# bot v2", string req = "discord.py==2.4.0 --hash=sha256:aa") => new()
    {
        ["bot.py"] = bot,
        ["_pyguard.py"] = "# guard",
        ["trust.py"] = "# trust",
        ["card.py"] = "# card",
        ["staff-channel.txt"] = "1549254991082946570",
        ["dev-channel.txt"] = "1550000000000000000",
        ["requirements.txt"] = req,
        ["factions.json"] = "{}",
        ["assets/join-card.png"] = "PNG",
    };

    static void BotNow(string root)
    {
        Put(root, BotFiles("# bot v1"));
        Put(root, new()
        {
            ["bot.env.json"] = "{\"token\":\"secret\"}",
            ["data/bot.log"] = "[thornswood-bot] watching 1 server\n",
            ["data/joins.json"] = "{}",
            ["py-libs/discord.py"] = "old libs",
            ["service/host.json"] = "{}",
            ["webhooks/news.txt"] = "x",
            ["sample.py"] = "copied by hand",
            ["assets/sample.png"] = "copied by hand",
            ["notes.txt"] = "copied by hand",
        });
    }

    [Fact]
    public async Task ABotDeploymentSwapsTheCodeAndMovesAsideWhatIsNotItsOwn()
    {
        var r = Make(AppKinds.Discord);
        BotNow(r.Root);
        AppRelease(r.Gh, "build-7", "discord", Zip(BotFiles()));
        var id = r.Gh.AddDeployment("Discord bot", Commit, "{\"release\":\"build-7\",\"part\":\"discord\"}");
        await r.Agent.Pass(AppKinds.Discord, CancellationToken.None);
        States(r, id, "in_progress,success");
        Assert.Equal("# bot v2", Read(r.Root, "bot.py"));
        // The bot's own things stay; what somebody copied in goes aside with the old code.
        Assert.Equal("{\"token\":\"secret\"}", Read(r.Root, "bot.env.json"));
        Assert.Equal("old libs", Read(r.Root, "py-libs/discord.py"));
        Assert.True(Has(r.Root, "data/joins.json"));
        Assert.True(Has(r.Root, "webhooks/news.txt"));
        Assert.False(Has(r.Root, "sample.py"));
        Assert.False(Has(r.Root, "assets/sample.png"));
        Assert.False(Has(r.Root, "notes.txt"));
        Assert.Equal("1550000000000000000", Read(r.Root, "dev-channel.txt"));
        var prev = Directory.GetDirectories(r.Root, ".prev-*").Single();
        Assert.Equal("# bot v1", Read(prev, "bot.py"));
        Assert.Equal("copied by hand", Read(prev, "sample.py"));
        Assert.Contains("bot.py", r.Control.Parsed);
        Assert.Equal(0, r.Control.Libs);
    }

    [Fact]
    public async Task ABotThatStopsAsItStartsIsPutBack()
    {
        var r = Make(AppKinds.Discord);
        BotNow(r.Root);
        AppRelease(r.Gh, "build-8", "discord", Zip(BotFiles("# BROKEN")));
        var id = r.Gh.AddDeployment("Discord bot", Commit, "{\"release\":\"build-8\",\"part\":\"discord\"}");
        await r.Agent.Pass(AppKinds.Discord, CancellationToken.None);
        States(r, id, "in_progress,failure");
        Assert.Contains("stopped as it started", LastSaid(r.Gh, id));
        Assert.Equal("# bot v1", Read(r.Root, "bot.py"));
        Assert.Equal("copied by hand", Read(r.Root, "sample.py"));
        Assert.Empty(Directory.GetDirectories(r.Root, ".prev-*"));
    }

    [Fact]
    public async Task ABotThatWritesNothingButRunsIsTakenAsUp()
    {
        var r = Make(AppKinds.Discord);
        BotNow(r.Root);
        AppRelease(r.Gh, "build-9", "discord", Zip(BotFiles("# SILENT")));
        var o = await r.Agent.DeployTag(AppKinds.Discord, "build-9", CancellationToken.None);
        Assert.Equal("success", o.State);
        Assert.Equal("# SILENT", Read(r.Root, "bot.py"));
    }

    [Fact]
    public async Task NewLibrariesGoInWithTheCodeAndBackWithIt()
    {
        var r = Make(AppKinds.Discord);
        BotNow(r.Root);
        AppRelease(r.Gh, "build-10", "discord", Zip(BotFiles(req: "discord.py==2.5.0 --hash=sha256:bb")));
        var o = await r.Agent.DeployTag(AppKinds.Discord, "build-10", CancellationToken.None);
        Assert.Equal("success", o.State);
        Assert.Equal(1, r.Control.Libs);
        Assert.Equal("discord.py==2.5.0 --hash=sha256:bb", Read(r.Root, "py-libs/discord.py"));
        Assert.Equal("old libs", Read(Directory.GetDirectories(r.Root, ".prev-*").Single(), "py-libs/discord.py"));

        // A bot that does not come up on new libraries gets the old ones back too.
        var r2 = Make(AppKinds.Discord);
        BotNow(r2.Root);
        AppRelease(r2.Gh, "build-11", "discord", Zip(BotFiles("# BROKEN", "discord.py==2.5.0 --hash=sha256:bb")));
        var o2 = await r2.Agent.DeployTag(AppKinds.Discord, "build-11", CancellationToken.None);
        Assert.Equal("failure", o2.State);
        Assert.Equal("old libs", Read(r2.Root, "py-libs/discord.py"));
    }

    [Fact]
    public async Task LibrariesThatDoNotInstallStopNothing()
    {
        var r = Make(AppKinds.Discord);
        BotNow(r.Root);
        r.Control.LibsSay = "pip ended with 1: ERROR: hashes do not match";
        AppRelease(r.Gh, "build-12", "discord", Zip(BotFiles(req: "discord.py==2.5.0 --hash=sha256:bb")));
        var o = await r.Agent.DeployTag(AppKinds.Discord, "build-12", CancellationToken.None);
        Assert.Equal("failure", o.State);
        Assert.Contains("the libraries did not install", o.Summary);
        Assert.Equal((0, 0), (r.Control.Stops, r.Control.Starts));
        Assert.Equal("# bot v1", Read(r.Root, "bot.py"));
    }

    [Theory]
    [InlineData("bot.env.json")]
    [InlineData("data/joins.json")]
    [InlineData("py-libs/discord.py")]
    [InlineData("service/host.json")]
    [InlineData("deep/er/file.py")]
    public async Task ABotReleaseNeverCarriesTheBotsOwnFiles(string rel)
    {
        var r = Make(AppKinds.Discord);
        BotNow(r.Root);
        var files = BotFiles();
        files[rel] = "{}";
        AppRelease(r.Gh, "build-13", "discord", Zip(files));
        var o = await r.Agent.DeployTag(AppKinds.Discord, "build-13", CancellationToken.None);
        Assert.Equal("failure", o.State);
        Assert.Contains("not one of the Discord bot's files a Release may carry", o.Summary);
        Assert.Equal("{\"token\":\"secret\"}", Read(r.Root, "bot.env.json"));
    }

    // ---- the config --------------------------------------------------------

    [Fact]
    public void ConfigReadsDevsVoiceOnlyWhereItIsNamed()
    {
        var p = Path.Combine(Temp(), "agent.json");
        File.WriteAllText(p, "{\"repo\":\"O/R\",\"environments\":{\"dev\":{\"store\":\"D:\\\\Deploys\"}}}");
        Assert.Null(Config.Load(p).Environments["dev"].Voice);
        File.WriteAllText(p, "{\"repo\":\"O/R\",\"environments\":{\"dev\":{\"store\":\"D:\\\\Deploys\",\"voice\":{\"waitSeconds\":45}}}}");
        var v = Config.Load(p).Environments["dev"].Voice!;
        Assert.Equal((AppKinds.Voice, @"C:\Thornswood-Voice-Dev", "Thornswood Dev Voice", "http://127.0.0.1:7789/health", 45, @"D:\Deploys"),
            (v.Kind, v.Root, v.Task, v.Health, v.WaitSeconds, v.Store));
    }

    [Fact]
    public void ConfigReadsTheSiteAndTheBot()
    {
        var p = Path.Combine(Temp(), "agent.json");
        File.WriteAllText(p, "{\"repo\":\"O/R\",\"environments\":{\"site\":{\"logDir\":\"C:\\\\Thornswood-Server-Dev\\\\data\"},\"discord\":{\"waitSeconds\":120}}}");
        var c = Config.Load(p);
        var s = c.Environments["site"];
        var d = c.Environments["discord"];
        Assert.Equal((AppKinds.Site, "Site", @"C:\Thornswood-Docs", "Thornswood Docs", @"C:\Thornswood-Server-Dev\data"), (s.Kind, s.GitHubEnvironment, s.Root, s.Task, s.LogDir));
        Assert.Equal((AppKinds.Discord, "Discord bot", @"C:\Thornswood-Bot", "ThornswoodBot", 120), (d.Kind, d.GitHubEnvironment, d.Root, d.Service, d.WaitSeconds));
        foreach (var bad in new[]
        {
            "{\"repo\":\"O/R\",\"environments\":{\"voice\":{}}}",
            "{\"repo\":\"O/R\",\"environments\":{\"site\":{\"githubEnvironment\":\"Main\"}}}",
            "{\"repo\":\"O/R\",\"environments\":{\"site\":{\"health\":\"\"}}}",
            "{\"repo\":\"O/R\",\"environments\":{\"discord\":{\"service\":\"\"}}}",
            "{\"repo\":\"O/R\",\"environments\":{\"discord\":{\"waitSeconds\":1}}}",
            "{\"repo\":\"O/R\",\"environments\":{\"site\":{\"logDir\":\"logs\"}}}",
            "{\"repo\":\"O/R\",\"environments\":{\"dev\":{\"voice\":{\"root\":\"voice\"}}}}",
            "{\"repo\":\"O/R\",\"environments\":{\"dev\":{\"voice\":{\"task\":\"\"}}}}",
        })
        {
            File.WriteAllText(p, bad);
            Assert.Throws<ConfigException>(() => Config.Load(p));
        }
    }
}
