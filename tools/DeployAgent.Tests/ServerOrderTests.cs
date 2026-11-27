using System.Text.Json.Nodes;
using Thornswood.DeployAgent;
using Xunit;

namespace Thornswood.DeployAgent.Tests;

// ---- a server runs the load order its Release was built for (#6209) ---------
//
// 15 Nov 2026: build-1.3.72's catalogue, the first the box built, names
// collection revision 8's 107 plugins (Improved Eyes Skyrim.esp among them),
// and dev ran revision 7's 106, so the gamemode started no NPC runtime and
// the bot pass refused the Deployment at merchants.

public sealed partial class AgentTests
{
    const string Eyes = "Improved Eyes Skyrim.esp";
    static readonly byte[] EyesEsp = B("plugin eyes");

    static string Catalogue(params string[] plugins) =>
        new JsonObject { ["version"] = 1, ["plugins"] = new JsonArray(plugins.Select(p => (JsonNode)JsonValue.Create(p)!).ToArray()), ["keep"] = new JsonObject() }.ToJsonString();

    static byte[] CollectionRecord(params (string name, byte[] bytes)[] rows) => B(new JsonObject
    {
        ["version"] = 1, ["collection"] = "7essxf", ["revision"] = 8,
        ["plugins"] = new JsonArray(rows.Select(r => (JsonNode)new JsonObject { ["name"] = r.name, ["size"] = r.bytes.Length, ["sha256"] = Sha(r.bytes) }).ToArray()),
    }.ToJsonString());

    /// <summary>MakeWithPass's dev, on a server build of its own, with the
    /// box's store of revision 8 holding Improved Eyes and the record of the
    /// Release's commit naming it; the pass, when it runs, passes and keeps
    /// the copy's settings.</summary>
    (Agent a, FakeGitHub gh, FakeServer s, BotPass bp, string store, Func<JsonObject?> seen) MakeOrder()
    {
        JsonObject? copy = null;
        var (a, gh, s, bp, cfg) = MakeWithPassAndConfig(bp =>
        {
            copy = JsonNode.Parse(File.ReadAllText(Path.Combine(bp.ServerDir, "server-settings.json")))!.AsObject();
            return WriteResult(bp, true);
        });
        var (files, rec) = Build(ForkA);
        Install(s, files, rec);
        var store = Temp();
        Directory.CreateDirectory(Path.Combine(store, "7essxf-8"));
        File.WriteAllBytes(Path.Combine(store, "7essxf-8", Eyes), EyesEsp);
        cfg.CollectionStore = store;
        gh.Contents[ServerOrder.Record + "@" + Commit] = CollectionRecord(("Skyrim.esm", B("plugin Skyrim.esm")), ("Thornswood.esp", B("plugin Thornswood.esp")), (Eyes, EyesEsp));
        return (a, gh, s, bp, store, () => copy);
    }

    static List<string> OrderOf(FakeServer s) =>
        ServerOrder.Entries(JsonNode.Parse(s.Read("server-settings.json"))!);

    [Fact]
    public async Task ANewOrderGoesInWithTheReleaseAndTheBotPassRunsOnIt()
    {
        var (a, gh, s, bp, _, seen) = MakeOrder();
        BotRelease(gh, "build-1", "// new gamemode\n", tables: new() { [ServerOrder.Table] = Catalogue("Skyrim.esm", "Thornswood.esp", Eyes) });
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-1\"}");
        await a.Pass("dev", default);
        HasStates(gh, s, id, "in_progress,success");
        var log = s.Read(Path.Combine("data", $"deploy-{id}.log"));
        Assert.Contains("this Release's gamemode runs on 3 plugins, and dev loads 2", log);
        Assert.Contains($"{Eyes} from the box's store of 7essxf revision 8", log);
        Assert.Contains("on its load order of 3 plugins", log);

        // The bot pass ran on the new order, with the plugin from the store.
        var copy = seen()!;
        Assert.Equal(new[] { "Skyrim.esm", "Thornswood.esp", Eyes }, copy["loadOrder"]!.AsArray().Select(x => Path.GetFileName(x!.GetValue<string>())));
        Assert.Equal(EyesEsp, File.ReadAllBytes(Path.Combine(bp.PluginDir, Eyes)));

        // Dev: the order the gamemode runs on, the plugin in its plugins
        // folder, its other settings as they were, one restart.
        var order = OrderOf(s);
        Assert.Equal(new[] { "Skyrim.esm", "Thornswood.esp" }, order.Take(2));
        Assert.Equal(Path.Combine(s.Root, "plugins").Replace('\\', '/') + "/" + Eyes, order[2]);
        Assert.Equal(EyesEsp, File.ReadAllBytes(Path.Combine(s.Root, "plugins", Eyes)));
        Assert.Contains("dev-secret-pw", s.Read("server-settings.json"));
        Assert.Equal("// new gamemode\n", s.Read("gamemode.js"));
        Assert.True(s.Running);
        var prev = Assert.Single(Directory.GetDirectories(s.Root, ".prev-*"));
        Assert.Equal(2, ServerOrder.Entries(JsonNode.Parse(File.ReadAllText(Path.Combine(prev, "server-settings.json")))!).Count);
    }

    [Fact]
    public async Task AnOrderTheServerRunsAlreadyIsNotTouched()
    {
        var (a, gh, s, _, _, seen) = MakeOrder();
        var before = s.Read("server-settings.json");
        BotRelease(gh, "build-2", "// new gamemode\n", tables: new() { [ServerOrder.Table] = Catalogue("Skyrim.esm", "Thornswood.esp") });
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-2\"}");
        await a.Pass("dev", default);
        HasStates(gh, s, id, "in_progress,success");
        Assert.Contains("dev loads the 2 plugins this Release's gamemode runs on", s.Read(Path.Combine("data", $"deploy-{id}.log")));
        Assert.Equal(before, s.Read("server-settings.json"));
        Assert.Equal(2, seen()!["loadOrder"]!.AsArray().Count);
    }

    [Theory]
    [InlineData("drop")]
    [InlineData("not in the store")]
    [InlineData("other bytes in the store")]
    [InlineData("not in the record")]
    public async Task AnOrderThatCannotBeTheServersLeavesItAsItWas(string how)
    {
        var (a, gh, s, bp, store, seen) = MakeOrder();
        var before = s.Read("server-settings.json");
        if (how == "not in the store") File.Delete(Path.Combine(store, "7essxf-8", Eyes));
        if (how == "other bytes in the store") File.WriteAllBytes(Path.Combine(store, "7essxf-8", Eyes), B("plugin other eyes"));
        if (how == "not in the record") gh.Contents[ServerOrder.Record + "@" + Commit] = CollectionRecord(("Skyrim.esm", B("plugin Skyrim.esm")));
        var want = how == "drop" ? Catalogue("Skyrim.esm", Eyes) : Catalogue("Skyrim.esm", "Thornswood.esp", Eyes);
        BotRelease(gh, "build-3", "// new gamemode\n", tables: new() { [ServerOrder.Table] = want });
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-3\"}");
        await a.Pass("dev", default);
        var last = gh.Last(id)!;
        Assert.Equal("failure", (string)last["state"]!);
        Assert.StartsWith("not applied: the load order: ", (string)last["description"]!);
        var log = s.Read(Path.Combine("data", $"deploy-{id}.log"));
        Assert.Contains(how switch
        {
            "drop" => "leaves out Thornswood.esp, which the server loads",
            "not in the record" => $"names {Eyes}, which the collection record of its commit",
            _ => $"adds {Eyes}, which is not on the server or in the box's store of 7essxf revision 8",
        }, log);
        Assert.Null(seen());
        Assert.Equal(before, s.Read("server-settings.json"));
        Assert.False(File.Exists(Path.Combine(s.Root, "plugins", Eyes)));
        Assert.Equal("// old gamemode\r\n", s.Read("gamemode.js"));
    }

    static byte[] DroppedRecord(int revision, string name, string why) => B(new JsonObject
    {
        ["version"] = 1, ["collection"] = "7essxf", ["revision"] = revision,
        ["dropped"] = new JsonArray(new JsonObject { ["name"] = name, ["mod"] = 1, ["why"] = why }),
    }.ToJsonString());

    // A revision that takes a plugin out (#4069): the Release commit's
    // records/collection-dropped.json names it for that commit's revision,
    // so the order may leave it out, and no other (27 Nov 2026: revision 13
    // took McmRecorder.esp out, and every drop had been refused).
    [Fact]
    public async Task APluginTheRevisionTakesOutLeavesTheOrder()
    {
        var (a, gh, s, _, _, seen) = MakeOrder();
        gh.Contents[ServerOrder.DroppedRecord + "@" + Commit] = DroppedRecord(8, "Thornswood.esp", "its forms are its menu");
        BotRelease(gh, "build-5", "// new gamemode\n", tables: new() { [ServerOrder.Table] = Catalogue("Skyrim.esm", Eyes) });
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-5\"}");
        await a.Pass("dev", default);
        HasStates(gh, s, id, "in_progress,success");
        var log = s.Read(Path.Combine("data", $"deploy-{id}.log"));
        Assert.Contains("Thornswood.esp leaves the server's order: records/collection-dropped.json takes it out with 7essxf revision 8", log);
        Assert.Equal(new[] { "Skyrim.esm", Eyes }, OrderOf(s).Select(ServerOrder.NameOf));
        Assert.Equal(new[] { "Skyrim.esm", Eyes }, seen()!["loadOrder"]!.AsArray().Select(x => ServerOrder.NameOf(x!.GetValue<string>())));
        Assert.Equal("// new gamemode\n", s.Read("gamemode.js"));
        // The engine is told its forms can go, so a save naming one loads.
        Assert.Contains("Thornswood.esp goes in forgetPlugins", log);
        Assert.Equal(new[] { "Thornswood.esp" }, ForgetOf(s));
        Assert.Equal(new[] { "Thornswood.esp" }, seen()!["forgetPlugins"]!.AsArray().Select(x => x!.GetValue<string>()));
    }

    static List<string> ForgetOf(FakeServer s) =>
        JsonNode.Parse(s.Read("server-settings.json"))!["forgetPlugins"] is JsonArray a ? a.Select(x => x!.GetValue<string>()).ToList() : new();

    [Fact]
    public void ForgetPluginsKeepsWhatWasForgottenAndLetsGoOfWhatLoadsAgain()
    {
        var root = Temp(); var stage = Temp(); var store = Temp();
        Directory.CreateDirectory(Path.Combine(root, ServerPlugins.Dir));
        foreach (var n in new[] { "Skyrim.esm", "A.esp", "B.esp" }) File.WriteAllBytes(Path.Combine(root, ServerPlugins.Dir, n), B("plugin " + n));
        File.WriteAllText(Path.Combine(root, ServerOrder.Settings), new JsonObject
        {
            ["loadOrder"] = new JsonArray("Skyrim.esm", "A.esp", "B.esp"),
            ["forgetPlugins"] = new JsonArray("Old.esp", "A.esp"),
        }.ToJsonString());
        var record = ServerOrder.ReadRecord(CollectionRecord(("Skyrim.esm", B("plugin Skyrim.esm")), ("A.esp", B("plugin A.esp")), ("B.esp", B("plugin B.esp"))));
        var lines = new List<string>();
        var move = ServerOrder.Stage(root, new[] { "Skyrim.esm", "A.esp" }, record, store, stage, Array.Empty<string>(), lines.Add, new[] { "B.esp" });
        var staged = JsonNode.Parse(File.ReadAllText(move.Files[ServerOrder.Settings]))!;
        Assert.Equal(new[] { "Old.esp", "B.esp" }, staged["forgetPlugins"]!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.Contains(lines, l => l.Contains("A.esp leaves forgetPlugins"));
    }

    [Theory]
    [InlineData("another revision")]
    [InlineData("no why")]
    public async Task ADropTheRecordDoesNotLetGoLeavesItAsItWas(string how)
    {
        var (a, gh, s, _, _, seen) = MakeOrder();
        var before = s.Read("server-settings.json");
        gh.Contents[ServerOrder.DroppedRecord + "@" + Commit] = how == "another revision"
            ? DroppedRecord(7, "Thornswood.esp", "its forms are its menu")
            : DroppedRecord(8, "Thornswood.esp", " ");
        BotRelease(gh, "build-6", "// new gamemode\n", tables: new() { [ServerOrder.Table] = Catalogue("Skyrim.esm", Eyes) });
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-6\"}");
        await a.Pass("dev", default);
        var last = gh.Last(id)!;
        Assert.Equal("failure", (string)last["state"]!);
        Assert.StartsWith("not applied: the load order: ", (string)last["description"]!);
        Assert.Contains(how == "another revision" ? "leaves out Thornswood.esp, which the server loads" : "without a plugin's file name and why it can go",
            s.Read(Path.Combine("data", $"deploy-{id}.log")));
        Assert.Null(seen());
        Assert.Equal(before, s.Read("server-settings.json"));
        Assert.Equal("// old gamemode\r\n", s.Read("gamemode.js"));
    }

    [Fact]
    public async Task ARecordThatCannotBeReadIsAnErrorAndNothingMoves()
    {
        var (a, gh, s, _, _, seen) = MakeOrder();
        gh.Contents.Clear();
        BotRelease(gh, "build-4", "// new gamemode\n", tables: new() { [ServerOrder.Table] = Catalogue("Skyrim.esm", "Thornswood.esp", Eyes) });
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-4\"}");
        await a.Pass("dev", default);
        var last = gh.Last(id)!;
        Assert.Equal("error", (string)last["state"]!);
        Assert.Contains("records/collection-plugins.json could not be read", (string)last["description"]!);
        Assert.Null(seen());
        Assert.Equal("// old gamemode\r\n", s.Read("gamemode.js"));
    }

    [Fact]
    public void TheOrderIsTheCataloguesAndOnlyFileNames()
    {
        var dir = Temp();
        string Zip(string body)
        {
            var z = Path.Combine(dir, Guid.NewGuid().ToString("n") + ".zip");
            File.WriteAllBytes(z, TablesZip(new() { [ServerOrder.Table] = body }));
            return z;
        }
        Assert.Equal(new[] { "Skyrim.esm", Eyes }, ServerOrder.Of(Zip(Catalogue("Skyrim.esm", Eyes))));
        var none = Path.Combine(dir, "none.zip");
        File.WriteAllBytes(none, TablesZip(new() { ["WEATHER.json"] = "{}" }));
        Assert.Null(ServerOrder.Of(none));
        Assert.Throws<InvalidDataException>(() => ServerOrder.Of(Zip(Catalogue("..\\x.esp"))));
        Assert.Throws<InvalidDataException>(() => ServerOrder.Of(Zip(Catalogue("a.esp", "A.esp"))));
        Assert.Throws<InvalidDataException>(() => ServerOrder.Of(Zip("{\"version\":1}")));
        var root = Temp();
        File.WriteAllText(Path.Combine(root, ServerOrder.Settings), "{\"loadOrder\":[]}");
        var rec = ServerOrder.ReadRecord(CollectionRecord(("a.esp", B("a"))));
        foreach (var bad in new[] { "/etc/x.esp", "..", "sub/a.esp", "C:\\x.esp" })
            Assert.Throws<InvalidDataException>(() => ServerOrder.Stage(root, [bad], rec, Temp(), Path.Combine(root, "stage"), [], _ => { }));
        Assert.True(ServerOrder.Same(["C:/S/plugins/a.esp", "b.esp"], ["a.esp", "b.esp"]));
        Assert.False(ServerOrder.Same(["b.esp", "a.esp"], ["a.esp", "b.esp"]));
    }
}
