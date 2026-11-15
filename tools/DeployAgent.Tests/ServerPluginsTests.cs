using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Thornswood.DeployAgent;
using Xunit;

namespace Thornswood.DeployAgent.Tests;

// ---- a server's own plugins are the Release's (#6175) ------------------------
//
// 15 Nov 2026: main took build-1.3.69, whose game files carry the box's
// Thornswood-Content.esp and Thornswood-Last.recipe, and kept the committed
// plugins it had, so every launcher on main refused Play.

public sealed partial class AgentTests
{
    /// <summary>A plugin of one record, the way RecordData reads one: type,
    /// size, flags (not compressed), 12 more header bytes, then the data.</summary>
    static byte[] OneRecord(string type, string data)
    {
        var d = B(data);
        var b = new byte[24 + d.Length];
        Encoding.ASCII.GetBytes(type).CopyTo(b, 0);
        BitConverter.GetBytes((uint)d.Length).CopyTo(b, 4);
        d.CopyTo(b, 24);
        return b;
    }

    static void Varint(MemoryStream w, long n)
    {
        while (true)
        {
            var x = (byte)(n & 0x7F);
            n >>= 7;
            if (n == 0) { w.WriteByte(x); return; }
            w.WriteByte((byte)(x | 0x80));
        }
    }

    /// <summary>A version 1 recipe (last_recipe.py's format) whose plugin is
    /// "LAST" then the data of each plugin's one record, in order; and the
    /// plugin it makes.</summary>
    static (byte[] recipe, byte[] made) Recipe(params (string name, byte[] bytes)[] plugins)
    {
        var made = new MemoryStream();
        made.Write(B("LAST"));
        foreach (var (_, b) in plugins) made.Write(b, 24, b.Length - 24);
        var m = made.ToArray();
        var w = new MemoryStream();
        w.Write(B("TSLR"));
        w.WriteByte(1);
        w.Write(BitConverter.GetBytes((uint)m.Length));
        w.Write(SHA256.HashData(m));
        Varint(w, plugins.Length);
        foreach (var (name, b) in plugins)
        {
            w.WriteByte(0);
            Varint(w, Encoding.UTF8.GetByteCount(name));
            w.Write(B(name));
            Varint(w, b.Length);
            w.Write(SHA256.HashData(b));
        }
        w.WriteByte(0); Varint(w, 4); w.Write(B("LAST"));
        for (int i = 0; i < plugins.Length; i++)
        {
            var n = plugins[i].bytes.Length - 24;
            w.WriteByte(1); Varint(w, i); Varint(w, 0);
            w.WriteByte(2); Varint(w, 0); Varint(w, n);
        }
        return (w.ToArray(), m);
    }

    /// <summary>The game part as merge-release.yml makes it: game.zip at the
    /// game folder's paths, and game-files.json listing each file.</summary>
    static Dictionary<string, byte[]> GamePart(byte[] content, byte[] recipe, string? lie = null)
    {
        var files = new Dictionary<string, byte[]>
        {
            ["Data/Thornswood-Content.esp"] = content,
            ["Data/Thornswood-Last.recipe"] = recipe,
            ["Data/SKSE/Plugins/other.dll"] = B("dll"),
        };
        using var ms = new MemoryStream();
        using (var za = new ZipArchive(ms, ZipArchiveMode.Create, true))
            foreach (var (n, b) in files)
                using (var e = za.CreateEntry(n).Open()) e.Write(b);
        var list = new JsonObject
        {
            ["schema"] = 1,
            ["files"] = new JsonArray(files.Select(kv => (JsonNode)new JsonObject
            {
                ["path"] = kv.Key,
                ["size"] = kv.Value.Length,
                ["sha256"] = lie == kv.Key ? new string('0', 64) : Sha(kv.Value),
            }).ToArray()),
        };
        return new() { [ServerPlugins.GameZip] = ms.ToArray(), [ServerPlugins.GameFiles] = B(list.ToJsonString()) };
    }

    static void PluginRelease(FakeGitHub gh, string tag, string gamemode, byte[] record, Dictionary<string, byte[]> game,
        Dictionary<string, byte[]>? serverFiles = null)
    {
        var parts = new Dictionary<string, Dictionary<string, byte[]>>
        {
            ["gamemode"] = new() { ["gamemode.js"] = B(gamemode), ["thornswood-build.json"] = B("{\"commit\":\"new\"}") },
            ["game"] = game,
        };
        if (serverFiles != null)
        {
            var zip = Zip(serverFiles, record);
            parts["server"] = new() { ["server-build.json"] = record, ["server-" + Sha(record)[..12] + "-" + Sha(zip)[..16] + ".zip"] = zip };
        }
        else parts["server"] = new() { ["server-build.json"] = record, ["server-" + Sha(record)[..12] + "-0000000000000000.zip"] = B("never fetched") };
        gh.AddRelease(tag, ReleaseFiles(tag, Commit, "", parts));
    }

    static void PutPlugin(FakeServer s, string name, byte[] b)
    {
        Directory.CreateDirectory(Path.Combine(s.Root, ServerPlugins.Dir));
        File.WriteAllBytes(Path.Combine(s.Root, ServerPlugins.Dir, name), b);
    }

    static byte[] PluginOf(FakeServer s, string name) => File.ReadAllBytes(Path.Combine(s.Root, ServerPlugins.Dir, name));

    // The server's own plugins before: the committed content plugin and the
    // Last plugin its recipe made. The Release's: the box's content plugin.
    static readonly byte[] TheirsEsp = OneRecord("CELL", "their cell");
    static readonly byte[] OldContent = OneRecord("BOOK", "committed book");
    static readonly byte[] NewContent = OneRecord("BOOK", "box built book");

    [Fact]
    public async Task MainTakesTheReleasesPluginsWithARestartAndKeepsItsServerBuild()
    {
        var (a, gh, s, _) = MakeMain();
        var (files, rec) = Build(ForkA);
        Install(s, files, rec);
        var (_, oldLast) = Recipe(("Thornswood-Content.esp", OldContent), ("Theirs.esp", TheirsEsp));
        PutPlugin(s, "Theirs.esp", TheirsEsp);
        PutPlugin(s, ServerPlugins.Content, OldContent);
        PutPlugin(s, ServerPlugins.Last, oldLast);
        var (recipe, newLast) = Recipe(("Thornswood-Content.esp", NewContent), ("Theirs.esp", TheirsEsp));
        PluginRelease(gh, "build-69", "// gamemode 69\n", rec, GamePart(NewContent, recipe));
        var id = Promoted(gh, "build-69", 69);
        await a.Pass("main", default);
        HasStates(gh, s, id, "in_progress,success");
        // The whole line is in the deploy log; a status description is cut at 140 characters.
        var log = s.Read(Path.Combine("data", $"deploy-{id}.log"));
        Assert.Contains("runs server build aaaaaaaaaaaa and gamemode blob", log);
        Assert.Contains("and the Release's Thornswood-Content.esp and Thornswood-Last.esp, restarted", log);
        Assert.Contains("the stage checks out: the server build it runs, aaaaaaaaaaaa, kept", log);
        Assert.Equal(NewContent, PluginOf(s, ServerPlugins.Content));
        Assert.Equal(newLast, PluginOf(s, ServerPlugins.Last));
        Assert.Equal(TheirsEsp, PluginOf(s, "Theirs.esp"));
        Assert.Equal(rec, File.ReadAllBytes(Path.Combine(s.Root, "server-build.json")));
        foreach (var (rel, b) in files) Assert.Equal(Sha(b), Sha(File.ReadAllBytes(Path.Combine(s.Root, rel))));
        Assert.Equal("// gamemode 69\n", s.Read("gamemode.js"));
        Assert.True(s.Running);
        var prev = Assert.Single(Directory.GetDirectories(s.Root, ".prev-*"));
        Assert.Equal(OldContent, File.ReadAllBytes(Path.Combine(prev, ServerPlugins.Dir, ServerPlugins.Content)));
        Assert.Equal(oldLast, File.ReadAllBytes(Path.Combine(prev, ServerPlugins.Dir, ServerPlugins.Last)));
        Assert.DoesNotContain(gh.Downloaded, d => d.StartsWith("server-") && d.EndsWith(".zip"));
    }

    [Fact]
    public async Task PluginsThatAreAlreadyTheReleasesGoWithAReloadAndNoStop()
    {
        var (a, gh, s, server, _) = Make();
        var (files, rec) = Build(ForkA);
        Install(s, files, rec);
        var (recipe, made) = Recipe(("Thornswood-Content.esp", NewContent), ("Theirs.esp", TheirsEsp));
        PutPlugin(s, "Theirs.esp", TheirsEsp);
        PutPlugin(s, ServerPlugins.Content, NewContent);
        PutPlugin(s, ServerPlugins.Last, made);
        PluginRelease(gh, "build-70", "// gamemode 70\n", rec, GamePart(NewContent, recipe));
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-70\"}");
        await a.Pass("dev", default);
        HasStates(gh, s, id, "in_progress,success");
        Assert.Equal((0, 0), (((FakeControl)server.Control).Stops, ((FakeControl)server.Control).Starts));
        Assert.Equal("// gamemode 70\n", s.Read("gamemode.js"));
        Assert.Contains(said, l => l.Contains("are already this Release's"));
    }

    [Fact]
    public async Task AnEnginePinAndNewPluginsGoInWithOneSwap()
    {
        var (a, gh, s, server, _) = Make();
        var (oldFiles, oldRec) = Build(ForkA);
        Install(s, oldFiles, oldRec);
        PutPlugin(s, "Theirs.esp", TheirsEsp);
        PutPlugin(s, ServerPlugins.Content, OldContent);
        var (newFiles, newRec) = Build(ForkB);
        var (recipe, made) = Recipe(("Thornswood-Content.esp", NewContent), ("Theirs.esp", TheirsEsp));
        PluginRelease(gh, "build-71", "// gamemode 71\n", newRec, GamePart(NewContent, recipe), newFiles);
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-71\"}");
        await a.Pass("dev", default);
        HasStates(gh, s, id, "in_progress,success");
        Assert.Equal((1, 1), (((FakeControl)server.Control).Stops, ((FakeControl)server.Control).Starts));
        Assert.Equal(newRec, File.ReadAllBytes(Path.Combine(s.Root, "server-build.json")));
        Assert.Equal(NewContent, PluginOf(s, ServerPlugins.Content));
        Assert.Equal(made, PluginOf(s, ServerPlugins.Last));
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("other")]
    [InlineData("lie")]
    public async Task PluginsThatCannotBeTheReleasesLeaveTheServerAsItWas(string how)
    {
        var (a, gh, s, server, _) = Make();
        var (files, rec) = Build(ForkA);
        Install(s, files, rec);
        if (how != "missing") PutPlugin(s, "Theirs.esp", how == "other" ? OneRecord("CELL", "their other cell") : TheirsEsp);
        PutPlugin(s, ServerPlugins.Content, OldContent);
        var (recipe, _) = Recipe(("Thornswood-Content.esp", NewContent), ("Theirs.esp", TheirsEsp));
        PluginRelease(gh, "build-72", "// gamemode 72\n", rec, GamePart(NewContent, recipe, lie: how == "lie" ? "Data/Thornswood-Content.esp" : null));
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-72\"}");
        await a.Pass("dev", default);
        var last = gh.Last(id)!;
        Assert.Equal("failure", (string)last["state"]!);
        Assert.Contains(how == "lie" ? "is not the file its game-files.json names" : "could not be made from the Release's recipe", (string)last["description"]!);
        Assert.Equal((0, 0), (((FakeControl)server.Control).Stops, ((FakeControl)server.Control).Starts));
        Assert.Equal(OldContent, PluginOf(s, ServerPlugins.Content));
        Assert.False(File.Exists(Path.Combine(s.Root, ServerPlugins.Dir, ServerPlugins.Last)));
        Assert.Equal("// old gamemode\r\n", s.Read("gamemode.js"));
    }

    [Fact]
    public void ALastPluginMadeHereIsTheOneTheRecipeNames()
    {
        var root = Temp();
        Directory.CreateDirectory(Path.Combine(root, ServerPlugins.Dir));
        File.WriteAllBytes(Path.Combine(root, ServerPlugins.Dir, "Theirs.esp"), TheirsEsp);
        var (recipe, made) = Recipe(("Thornswood-Content.esp", NewContent), ("Theirs.esp", TheirsEsp));
        var g = GamePart(NewContent, recipe);
        var zip = Path.Combine(root, "game.zip");
        File.WriteAllBytes(zip, g[ServerPlugins.GameZip]);
        var w = ServerPlugins.Read(zip, g[ServerPlugins.GameFiles]);
        Assert.Equal(Sha(made), w.LastSha);
        Assert.Equal([ServerPlugins.Content, ServerPlugins.Last], ServerPlugins.Differ(root, w));
        var staged = ServerPlugins.Stage(root, Path.Combine(root, "stage"), w, "", _ => { });
        Assert.Equal(made, File.ReadAllBytes(staged["plugins/Thornswood-Last.esp"]));
        Assert.Equal(NewContent, File.ReadAllBytes(staged["plugins/Thornswood-Content.esp"]));
    }
}
