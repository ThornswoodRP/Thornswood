#nullable enable
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Thornswood.DeployAgent;
using Xunit;

namespace Thornswood.DeployAgent.Tests;

// The steps after a deploy (#5186).
public sealed partial class AgentTests
{
    static readonly string Verbs = """
        { "verbs": {
            "Reset-Npcs-Dev": { "script": "a.ps1", "afterDeploy": ["dev"] },
            "Check-ProdParity": { "script": "b.ps1", "afterDeploy": ["dev", "main"] },
            "Publish-Server-Main": { "script": "c.ps1", "afterDeploy": ["main"] },
            "Wipe-Dev": { "script": "d.ps1" } } }
        """;

    static Dictionary<string, byte[]> StepFiles(params (string Name, string Json)[] files)
    {
        var o = new Dictionary<string, byte[]> { [AfterDeploy.VerbsFile] = B(Verbs) };
        foreach (var (n, j) in files) o[n] = B(j);
        return o;
    }

    static List<string> Problems(params (string Name, string Json)[] files)
    {
        var errors = new List<string>();
        AfterDeploy.Plan(StepFiles(files), errors);
        return errors;
    }

    const string Good = """{ "issue": 5186, "environment": "dev", "steps": [ { "run": "Reset-Npcs-Dev -Survey" }, { "inGame": "Walk in at Whiterun's main gate.", "doneWhen": "No lock prompt shows." } ] }""";

    [Fact]
    public void AStepFileThatHoldsIsPlannedInOrderWithItsIds()
    {
        var errors = new List<string>();
        var plan = AfterDeploy.Plan(StepFiles(("5300-later.json", """{ "issue": 5300, "environment": "dev", "steps": [ { "run": "Check-ProdParity" } ] }"""), ("5186-gates.json", Good)), errors);
        Assert.Empty(errors);
        Assert.Equal(["5186-gates#1", "5186-gates#2", "5300-later#1"], plan.Select(p => p.Id));
        Assert.Equal("Reset-Npcs-Dev -Survey", plan[0].Step.Run);
        Assert.Equal(5186, plan[1].Issue);
    }

    [Theory]
    [InlineData("5186_gates.json", Good, "its name is not")]
    [InlineData("5187-gates.json", Good, "its issue is 5186 and its name says 5187")]
    [InlineData("5186-gates.json", """{ "issue": 5186, "environment": "live", "steps": [ { "run": "Reset-Npcs-Dev" } ] }""", "not dev or main")]
    [InlineData("5186-gates.json", """{ "issue": 5186, "environment": "dev", "steps": [] }""", "it has no steps")]
    [InlineData("5186-gates.json", """{ "issue": 5186, "environment": "dev", "steps": [ { "run": "Wipe-Dev" } ] }""", "Wipe-Dev is not a verb verbs.json lets run after a deploy")]
    [InlineData("5186-gates.json", """{ "issue": 5186, "environment": "dev", "steps": [ { "run": "Publish-Server-Main" } ] }""", "lets Publish-Server-Main run after a deploy to main only, not dev")]
    [InlineData("5186-gates.json", """{ "issue": 5186, "environment": "dev", "steps": [ { "run": "Reset-Npcs-Dev", "inGame": "Walk in at the gate." } ] }""", "not exactly one of run or inGame")]
    [InlineData("5186-gates.json", """{ "issue": 5186, "environment": "dev", "steps": [ { "inGame": "Walk in at the gate." } ] }""", "doneWhen is missing")]
    [InlineData("5186-gates.json", """{ "issue": 5186, "environment": "dev", "steps": [ { "run": "Reset-Npcs-Dev -Why $(whoami)" } ] }""", "dollar sign")]
    [InlineData("5186-gates.json", """{ "issue": 5186, "environment": "dev", "steps": [ { "run": "Reset-Npcs-Dev" } ], "when": "now" }""", "does not read")]
    [InlineData("5186-gates.json", """{ "issue": 5186, "environment": "dev", "steps": [ { "inGame": "Walk in at the gate — quickly.", "doneWhen": "It opens." } ] }""", "em dash")]
    public void AStepFileThatBreaksARuleIsNamedAndNotPlanned(string name, string json, string why)
    {
        var errors = new List<string>();
        var plan = AfterDeploy.Plan(StepFiles((name, json)), errors);
        Assert.Empty(plan);
        Assert.Contains(errors, e => e.StartsWith(name + ": ") && e.Contains(why));
    }

    [Fact]
    public void WithoutTheGatesVerbsNothingMayRun()
    {
        var errors = new List<string>();
        Assert.Empty(AfterDeploy.Plan(new Dictionary<string, byte[]> { ["5186-gates.json"] = B(Good) }, errors));
        Assert.Contains("came without verbs.json", errors.Single());
        Assert.Contains("not dev or main", Assert.Throws<InvalidDataException>(() => AfterDeploy.AllowedVerbs(B("""{ "verbs": { "X": { "afterDeploy": ["live"] } } }"""))).Message);
    }

    /// <summary>A gamemode Release that carries steps after a deploy.</summary>
    static void StepsRelease(FakeGitHub gh, string tag, string body, Dictionary<string, byte[]> steps)
    {
        var part = new Dictionary<string, byte[]> { ["gamemode.js"] = B(body), ["thornswood-build.json"] = B("{\"commit\":\"new\"}") };
        gh.AddRelease(tag, ReleaseFiles(tag, Commit, "", new() { ["gamemode"] = part, [AfterDeploy.Part] = steps }));
    }

    /// <summary>The lines the gate was asked for that are steps after a
    /// deploy: a dev Deployment also moves the load order and runs the
    /// parity check through it (Agent.LoadOrder, Agent.Parity).</summary>
    static List<string> StepLines(FakeGate g) => g.Asked.Where(l => l != Agent.LoadOrderLine && l != "Check-ProdParity").ToList();

    JsonObject Published(FakeServer s, long id) => JsonNode.Parse(s.Read(Path.Combine("data", $"deploy-{id}.after.json")))!.AsObject();

    [Fact]
    public async Task ADeploymentRunsItsStepsOnceThroughTheGateAndRecordsEach()
    {
        var (a, gh, s, _, cfg) = Make();
        var gate = new FakeGate();
        gate.Answers["Reset-Npcs-Dev -Survey"] = new GateRun(0, ["the verb said something"]);
        a.Gate = gate;
        StepsRelease(gh, "build-1", "// new gamemode\n", StepFiles(("5186-gates.json", Good), ("5300-main.json", """{ "issue": 5300, "environment": "main", "steps": [ { "run": "Check-ProdParity" } ] }""")));
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-1\"}");
        await a.Pass("dev", default);
        HasStates(gh, s, id, "in_progress,success");
        // Only the dev file's run step; main's waits for a main deploy.
        Assert.Equal(["Reset-Npcs-Dev -Survey"], StepLines(gate));
        Assert.StartsWith("build-1: ", (string)gh.Last(id)!["description"]!);
        var log = s.Read(Path.Combine("data", $"deploy-{id}.log"));
        // The whole summary is the log's last line; GitHub's description is cut to fit.
        Assert.Matches("SUCCESS: build-1: .*; load order moved; 1 after-deploy step\\(s\\) ran, 1 in-game check\\(s\\) filed", log);
        Assert.Contains("after-deploy 5186-gates#1 (#5186): Reset-Npcs-Dev -Survey", log);
        Assert.Contains("  gate: the verb said something", log);
        Assert.Contains("after-deploy 5186-gates#2: for a person in the game: Walk in at Whiterun's main gate.", log);
        var pub = Published(s, id);
        Assert.Equal(Commit, (string)pub["commit"]!);
        var st = pub["steps"]!.AsArray();
        Assert.Equal("success,in-game", string.Join(",", st.Select(x => (string)x!["state"]!)));
        Assert.Equal("No lock prompt shows.", (string)st[1]!["doneWhen"]!);
        var kept = JsonSerializer.Deserialize<Dictionary<string, StepState>>(File.ReadAllText(Path.Combine(cfg.Home, "state", "after-dev.json")))!;
        Assert.Equal(("success", 0), (kept["5186-gates#1"].State, kept["5186-gates#1"].Code));

        // The next Release carries the same file: nothing runs a second time.
        StepsRelease(gh, "build-2", "// newer gamemode\n", StepFiles(("5186-gates.json", Good)));
        var id2 = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-2\"}");
        await a.Pass("dev", default);
        HasStates(gh, s, id2, "in_progress,success");
        Assert.Single(StepLines(gate));
        Assert.DoesNotContain("after-deploy", (string)gh.Last(id2)!["description"]!);
        Assert.Equal("done-before,done-before", string.Join(",", Published(s, id2)["steps"]!.AsArray().Select(x => (string)x!["state"]!)));
    }

    [Fact]
    public async Task AFailedStepLeadsTheDescriptionByItsIssueAndLeavesTheDeployIn()
    {
        var (a, gh, s, _, _) = Make();
        var gate = new FakeGate();
        gate.Answers["Reset-Npcs-Dev -Survey"] = new GateRun(3, ["the verb said something"]);
        a.Gate = gate;
        StepsRelease(gh, "build-1", "// new gamemode\n", StepFiles(("5186-gates.json", Good)));
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-1\"}");
        await a.Pass("dev", default);
        var last = gh.Last(id)!;
        Assert.Equal("success", (string)last["state"]!);
        Assert.StartsWith("after-deploy FAILED for #5186; build-1: ", (string)last["description"]!);
        Assert.Equal("// new gamemode\n", s.Read("gamemode.js"));
        Assert.Equal(3, (int)Published(s, id)["steps"]![0]!["code"]!);
    }

    [Fact]
    public async Task AStepTheAgentStoppedInIsNeverRunAgain()
    {
        var (a, gh, s, _, cfg) = Make();
        var gate = new FakeGate();
        a.Gate = gate;
        Files.WriteWhole(Path.Combine(cfg.Home, "state", "after-dev.json"),
            JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, StepState> { ["5186-gates#1"] = new() { State = "started", Utc = "2026-11-01T20:00:00Z", Deployment = "deployment-9" } }));
        StepsRelease(gh, "build-1", "// new gamemode\n", StepFiles(("5186-gates.json", Good)));
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-1\"}");
        await a.Pass("dev", default);
        Assert.Empty(StepLines(gate));
        Assert.StartsWith("after-deploy FAILED for #5186", (string)gh.Last(id)!["description"]!);
        Assert.Equal("cut-short", (string)Published(s, id)["steps"]![0]!["state"]!);
        Assert.Contains("the agent stopped before it ended; not run again", s.Read(Path.Combine("data", $"deploy-{id}.log")));
    }

    [Fact]
    public async Task AStepTheGateNeverTookRunsWithTheNextDeployment()
    {
        var (a, gh, s, _, _) = Make();
        var gate = new FakeGate();
        gate.Answers["Reset-Npcs-Dev -Survey"] = new GateRun(65, ["the gate did not take the request"], Taken: false);
        a.Gate = gate;
        StepsRelease(gh, "build-1", "// new gamemode\n", StepFiles(("5186-gates.json", Good)));
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-1\"}");
        await a.Pass("dev", default);
        Assert.Contains("1 wait for the gate", (string)gh.Last(id)!["description"]!);
        Assert.Equal("not-started", (string)Published(s, id)["steps"]![0]!["state"]!);
        gate.Answers.Remove("Reset-Npcs-Dev -Survey");
        StepsRelease(gh, "build-2", "// newer gamemode\n", StepFiles(("5186-gates.json", Good)));
        var id2 = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-2\"}");
        await a.Pass("dev", default);
        Assert.Equal(2, StepLines(gate).Count);
        Assert.Equal("success", (string)Published(s, id2)["steps"]![0]!["state"]!);
    }

    [Fact]
    public async Task NoStepRunsAfterAFailedDeployOrADeployByTag()
    {
        var (a, gh, s, _, _) = Make();
        var gate = new FakeGate();
        a.Gate = gate;
        StepsRelease(gh, "build-1", "BROKEN gamemode\n", StepFiles(("5186-gates.json", Good)));
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-1\"}");
        await a.Pass("dev", default);
        Assert.Equal("failure", (string)gh.Last(id)!["state"]!);
        Assert.Empty(StepLines(gate));
        Assert.False(File.Exists(Path.Combine(s.Root, "data", $"deploy-{id}.after.json")));
        StepsRelease(gh, "build-2", "// new gamemode\n", StepFiles(("5186-gates.json", Good)));
        Assert.Equal("success", (await a.DeployTag("dev", "build-2", default)).State);
        Assert.Empty(StepLines(gate));
        Assert.Contains(said, l => l.Contains("they run only with a Deployment, never with a deploy by tag or a rollback"));
    }

    [Fact]
    public async Task AStepFileThatBreaksARuleIsSaidAndTheRestRun()
    {
        var (a, gh, s, _, _) = Make();
        var gate = new FakeGate();
        a.Gate = gate;
        StepsRelease(gh, "build-1", "// new gamemode\n", StepFiles(("5186-gates.json", Good), ("5301-wipe.json", """{ "issue": 5301, "environment": "dev", "steps": [ { "run": "Wipe-Dev" } ] }""")));
        var id = gh.AddDeployment("Dev", Commit, "{\"release\":\"build-1\"}");
        await a.Pass("dev", default);
        Assert.Equal(["Reset-Npcs-Dev -Survey"], StepLines(gate));
        Assert.Contains("after-deploy: NOT RUN, the file breaks a rule: 5301-wipe.json: step 1: Wipe-Dev is not a verb", s.Read(Path.Combine("data", $"deploy-{id}.log")));
    }

    /// <summary>The repository's own steps and verbs hold, as a pull request's check holds them.</summary>
    [Fact]
    public void TheRepositorysOwnStepsHold()
    {
        var repo = AppContext.BaseDirectory;
        while (repo != null && !File.Exists(Path.Combine(repo, "scripts", "vps", "gate", "verbs.json"))) repo = Path.GetDirectoryName(repo);
        Assert.NotNull(repo);
        var lines = new List<string>();
        var code = AfterDeploy.CheckCommand(Path.Combine(repo!, "deploy", "after"), Path.Combine(repo!, "scripts", "vps", "gate", "verbs.json"), lines.Add);
        Assert.True(code == 0, string.Join("\n", lines));
        Assert.NotEmpty(AfterDeploy.AllowedVerbs(File.ReadAllBytes(Path.Combine(repo!, "scripts", "vps", "gate", "verbs.json"))));
    }
}
