#nullable enable
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Thornswood.DeployAgent;
using Xunit;

namespace Thornswood.DeployAgent.Tests;

// The content build (#5191, stage 3): a Deployment to Content is built by the
// gate's Build-Content verb and put on a draft Release named by its inputs.
public sealed partial class AgentTests
{
    const string KeyA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const string KeyB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const string BuiltFrom = "1111111111111111111111111111111111111111";

    static string ContentPayload(string key, string server = "dev") => $"{{\"content\":\"{key}\",\"server\":\"{server}\"}}";

    /// <summary>An agent looking after the content build alone, its gate a
    /// stand-in, and Build-Content's kept builds in a folder of the test's.</summary>
    (Agent agent, FakeGitHub gh, FakeGate gate, EnvConfig env) MakeContent(bool service = true)
    {
        var gh = new FakeGitHub();
        var http = new HttpClient(gh);
        owned.Add(http);
        var home = Temp();
        var env = Config.DefaultContent();
        env.Root = Temp();
        var cfg = new Config { Repo = "O/R", Api = FakeGitHub.Api, Home = home, Environments = { [ContentBuild.Kind] = env } };
        var gate = new FakeGate();
        var gh2 = new GitHub(FakeGitHub.Api, "O/R", new StaticToken("t"), http);
        var a = new Agent(cfg, gh2, new FakeVerifier(), new(), "1.0.0", "", l => { lock (said) said.Add(l); }) { Host = "box", Gate = service ? gate : null };
        if (service) a.Content = new ContentBuild(env, gh2, gate, Path.Combine(home, "work"));
        return (a, gh, gate, env);
    }

    /// <summary>A build as Build-Content keeps it: files\ at repository paths,
    /// and build.json naming each one's sha256.</summary>
    static Dictionary<string, byte[]> KeepBuild(EnvConfig env, string key, string server = "dev", string commit = BuiltFrom)
    {
        var files = new Dictionary<string, byte[]>
        {
            ["game/content/Thornswood-Content.esp"] = B("TES4 the plugin"),
            ["game/data/last-plugin.recipe"] = B("recipe"),
            ["game/gamemode-tables/Recipes.json"] = B("{\"r\":1}"),
        };
        var dir = Path.Combine(env.Root, server, key);
        foreach (var (n, b) in files)
        {
            var p = Path.Combine(dir, "files", n.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(p)!);
            File.WriteAllBytes(p, b);
        }
        var rec = new { issue = 5191, server, key, commit, built = "2026-11-12T23:00:00Z", files = files.ToDictionary(kv => kv.Key, kv => Sha(kv.Value)) };
        File.WriteAllBytes(Path.Combine(dir, "build.json"), JsonSerializer.SerializeToUtf8Bytes(rec));
        return files;
    }

    static void Builds(FakeGate gate, string key, string server = "dev", string commit = BuiltFrom) =>
        gate.Answers[$"Build-Content -Server {server}"] = new GateRun(0, [$"inputs: 40 files at {commit}", $"BUILT {key}", $"FROM {commit}", "3 files"]);

    void HasContentStates(FakeGitHub gh, long id, string want)
    {
        var got = string.Join(",", gh.States(id));
        if (got != want) Assert.Fail($"Deployment {id}: expected {want}, got {got}: {(string?)gh.Last(id)?["description"]}\n" + string.Join("\n", said));
    }

    [Fact]
    public async Task AContentDeploymentIsBuiltByTheGateAndPutUpAsADraftNamedByItsInputs()
    {
        var (a, gh, gate, env) = MakeContent();
        var files = KeepBuild(env, KeyA);
        Builds(gate, KeyA);
        var id = gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);

        HasContentStates(gh, id, "in_progress,success");
        Assert.Equal(["Build-Content -Server dev"], gate.Asked);
        Assert.Contains("built aaaaaaaaaaaa from 1111111", (string)gh.Last(id)!["description"]!);
        var draft = Assert.Single(gh.DraftList);
        Assert.Equal(ContentBuild.Tag("dev", KeyA), (string)draft["tag_name"]!);
        var up = gh.Uploaded[(long)draft["id"]!];
        Assert.Equal([ContentBuild.RecordName, ContentBuild.ZipName], up.Keys.Order(StringComparer.Ordinal));
        using var z = new ZipArchive(new MemoryStream(up[ContentBuild.ZipName]));
        Assert.Equal(files.Keys.Order(StringComparer.Ordinal), z.Entries.Select(e => e.FullName));
        foreach (var e in z.Entries)
        {
            using var s = e.Open();
            using var m = new MemoryStream();
            s.CopyTo(m);
            Assert.Equal(files[e.FullName], m.ToArray());
        }
        Assert.Equal(File.ReadAllBytes(Path.Combine(env.Root, "dev", KeyA, "build.json")), up[ContentBuild.RecordName]);
    }

    [Fact]
    public async Task TheSameBuildTwiceGivesTheSameZip()
    {
        var (a, gh, gate, env) = MakeContent();
        KeepBuild(env, KeyA);
        Builds(gate, KeyA);
        gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        var first = gh.Uploaded[(long)gh.DraftList[0]["id"]!][ContentBuild.ZipName];
        gh.DraftList.Clear();
        gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        Assert.Equal(first, gh.Uploaded[(long)gh.DraftList[0]["id"]!][ContentBuild.ZipName]);
    }

    [Fact]
    public async Task ADraftAlreadyUpWholeIsNotMadeAgain()
    {
        var (a, gh, gate, env) = MakeContent();
        KeepBuild(env, KeyA);
        Builds(gate, KeyA);
        gh.AddDraft(ContentBuild.Tag("dev", KeyA), DateTimeOffset.UtcNow.AddHours(-1), ContentBuild.ZipName, ContentBuild.RecordName);
        var id = gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        HasContentStates(gh, id, "in_progress,success");
        Assert.Equal(0, gh.DraftsMade);
        Assert.Single(gh.DraftList);
    }

    [Fact]
    public async Task ADraftCutShortIsTakenDownAndMadeAgainWhole()
    {
        var (a, gh, gate, env) = MakeContent();
        KeepBuild(env, KeyA);
        Builds(gate, KeyA);
        var cut = gh.AddDraft(ContentBuild.Tag("dev", KeyA), DateTimeOffset.UtcNow.AddHours(-1), ContentBuild.ZipName);
        var id = gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        HasContentStates(gh, id, "in_progress,success");
        var d = Assert.Single(gh.DraftList);
        Assert.NotEqual((long)cut["id"]!, (long)d["id"]!);
        Assert.Equal(2, gh.Uploaded[(long)d["id"]!].Count);
    }

    [Fact]
    public async Task AKeptBuildNotAsItsBuildJsonSaysIsNeverPutUp()
    {
        var (a, gh, gate, env) = MakeContent();
        KeepBuild(env, KeyA);
        File.WriteAllText(Path.Combine(env.Root, "dev", KeyA, "files", "game", "data", "last-plugin.recipe"), "changed");
        Builds(gate, KeyA);
        var id = gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        HasContentStates(gh, id, "in_progress,failure");
        Assert.Contains("has game/data/last-plugin.recipe not as its build.json says", (string)gh.Last(id)!["description"]!);
        Assert.Empty(gh.DraftList);
    }

    [Fact]
    public async Task ABuildJsonNamingAPathOutsideTheRepositoryIsRefused()
    {
        var (_, _, _, env) = MakeContent();
        var dir = Path.Combine(env.Root, "dev", KeyA);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "build.json"), $"{{\"key\":\"{KeyA}\",\"server\":\"dev\",\"commit\":\"{BuiltFrom}\",\"files\":{{\"../../x\":\"00\"}}}}");
        var (files, why) = ContentBuild.Read(dir, KeyA, "dev");
        Assert.Null(files);
        Assert.Contains("outside the repository", why);
    }

    [Fact]
    public async Task ABuildThatStopsFailsTheDeploymentWithWhatItSaid()
    {
        var (a, gh, gate, env) = MakeContent();
        gate.Answers["Build-Content -Server dev"] = new GateRun(1, ["inputs: 40 files", "STOP. Add-ContentRecords.py ended with exit 1. The chain did not run and nothing was kept."]);
        var id = gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        HasContentStates(gh, id, "in_progress,failure");
        Assert.Contains("exit 1: STOP. Add-ContentRecords.py", (string)gh.Last(id)!["description"]!);
        Assert.Empty(gh.DraftList);
    }

    [Fact]
    public async Task AGateThatNeverTookTheLineIsAnErrorNotAFailure()
    {
        var (a, gh, gate, _) = MakeContent();
        gate.Answers["Build-Content -Server dev"] = new GateRun(65, ["the gate did not take the request within 30 minutes"], Taken: false);
        var id = gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        HasContentStates(gh, id, "in_progress,error");
    }

    [Fact]
    public async Task AnUploadRefusedIsAnErrorAndLeavesTheDraftToBeMadeAgain()
    {
        var (a, gh, gate, env) = MakeContent();
        KeepBuild(env, KeyA);
        Builds(gate, KeyA);
        gh.UploadAnswer = System.Net.HttpStatusCode.Forbidden;
        var id = gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        HasContentStates(gh, id, "in_progress,error");
        Assert.Contains("built aaaaaaaaaaaa, not put up", (string)gh.Last(id)!["description"]!);
    }

    [Fact]
    public async Task WhenMainMovedOnTheBuildIsPutUpByWhatWasBuiltAndSaysSo()
    {
        var (a, gh, gate, env) = MakeContent();
        KeepBuild(env, KeyB);
        Builds(gate, KeyB);
        var id = gh.AddDeployment("Content", "2222222222222222222222222222222222222222", ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        HasContentStates(gh, id, "in_progress,success");
        Assert.Equal(ContentBuild.Tag("dev", KeyB), (string)Assert.Single(gh.DraftList)["tag_name"]!);
        Assert.Contains("main had moved on", (string)gh.Last(id)!["description"]!);
    }

    [Fact]
    public async Task TheNewestDraftsOfAServerAreKeptAndTheOtherServersAreLeftAlone()
    {
        var (a, gh, gate, env) = MakeContent();
        KeepBuild(env, KeyA);
        Builds(gate, KeyA);
        var t0 = DateTimeOffset.UtcNow.AddDays(-30);
        for (var i = 0; i < 20; i++) gh.AddDraft(ContentBuild.Tag("dev", i.ToString("x64")), t0.AddHours(i), ContentBuild.ZipName, ContentBuild.RecordName);
        gh.AddDraft(ContentBuild.Tag("main", KeyB), t0, ContentBuild.ZipName, ContentBuild.RecordName);
        gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        var dev = gh.DraftList.Where(d => ((string)d["tag_name"]!).StartsWith("content-dev-")).Select(d => (string)d["tag_name"]!).ToList();
        Assert.Equal(ContentBuild.Keep, dev.Count);
        Assert.Contains(ContentBuild.Tag("dev", KeyA), dev);
        Assert.Contains(ContentBuild.Tag("dev", 19.ToString("x64")), dev);
        Assert.DoesNotContain(ContentBuild.Tag("dev", 4.ToString("x64")), dev);
        Assert.Contains(gh.DraftList, d => (string)d["tag_name"]! == ContentBuild.Tag("main", KeyB));
    }

    [Theory]
    [InlineData("{\"release\":\"build-1\"}", "no payload naming a content key")]
    [InlineData("{\"content\":\"abc\",\"server\":\"dev\"}", "no payload naming a content key")]
    [InlineData("{\"content\":\"" + KeyA + "\",\"server\":\"live\"}", "not dev or main")]
    public async Task AContentDeploymentWithABadPayloadFailsAndRunsNothing(string payload, string why)
    {
        var (a, gh, gate, _) = MakeContent();
        var id = gh.AddDeployment("Content", BuiltFrom, payload);
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        HasContentStates(gh, id, "in_progress,failure");
        Assert.Contains(why, (string)gh.Last(id)!["description"]!);
        Assert.Empty(gate.Asked);
    }

    [Fact]
    public async Task ASingleLookLeavesContentDeploymentsToTheService()
    {
        var (a, gh, gate, _) = MakeContent(service: false);
        var id = gh.AddDeployment("Content", BuiltFrom, ContentPayload(KeyA));
        await a.Pass(ContentBuild.Kind, CancellationToken.None);
        Assert.Empty(gh.States(id));
        Assert.Empty(gate.Asked);
    }

    [Fact]
    public void AgentJsonNamesTheContentBuildAndItStartsFromItsDefault()
    {
        var p = Path.Combine(Temp(), "agent.json");
        File.WriteAllText(p, "{\"repo\":\"O/R\",\"environments\":{\"dev\":{},\"content\":{}}}");
        var c = Config.Load(p);
        Assert.Equal(ContentBuild.Kind, c.Environments["content"].Kind);
        Assert.Equal("Content", c.Environments["content"].GitHubEnvironment);
        Assert.Equal(@"C:\Thornswood-ContentBuilds", c.Environments["content"].Root);
        Assert.Equal(new SortedDictionary<string, string> { ["contents"] = "write" }, AppTokens.ContentsWrite);
    }
}
