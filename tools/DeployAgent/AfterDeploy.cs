#nullable enable
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Thornswood.DeployAgent;

/*
  STEPS AFTER A DEPLOY (#5186). A pull request whose change needs something
  done once it is deployed says so in a file of its own under deploy/after/,
  named for its issue (5186-reset-npcs.json), instead of a run note somebody
  has to remember:

      { "issue": 5186, "environment": "dev",
        "steps": [ { "run": "Reset-Npcs-Dev" },
                   { "inGame": "Walk in at Whiterun's main gate.", "doneWhen": "No lock prompt shows." } ] }

  A "run" step is one line for the deploy gate (scripts/vps/gate/), whose
  verb verbs.json marks as one that may run after a deploy to that
  environment ("afterDeploy": ["dev"]). An "inGame" step is a check only a
  person in the game can make; it becomes an issue labelled "check: in game"
  (.github/workflows/after-deploy.yml files it from what the agent lists).

  The signed Release carries every step file and verbs.json as its part
  "after", so the list of verbs the agent may run comes from the same signed
  commit as the steps and never from a file on the box: nobody can widen what
  this LocalSystem service runs by editing agent.json. After a Deployment of
  that Release succeeds, the agent runs each step it has not run on that
  environment, in file name order, through the gate broker's pipe (the gate
  holds the line to its own rules again), and keeps what ran in
  state\after-<environment>.json. A step is written down as started before it
  starts and as ended when it ends, so a step the agent was stopped in the
  middle of is never run a second time: it is said as cut short, and its
  issue gets the comment. Each step's result goes in the Deployment's log
  and in deploy-<id>.after.json beside it, which after-deploy.yml reads.
*/

/// <summary>One file under deploy/after/.</summary>
public sealed class StepFile
{
    [JsonPropertyName("issue")] public int Issue { get; set; }
    [JsonPropertyName("environment")] public string Environment { get; set; } = "";
    [JsonPropertyName("steps")] public List<Step> Steps { get; set; } = new();
}

/// <summary>One step: a gate line to run, or a check for a person in the game.</summary>
public sealed class Step
{
    [JsonPropertyName("run")] public string? Run { get; set; }
    [JsonPropertyName("inGame")] public string? InGame { get; set; }
    [JsonPropertyName("doneWhen")] public string? DoneWhen { get; set; }
}

/// <summary>A step as the agent runs it: its id (the file's name, a hash and
/// its place in the file, from 1), the issue it belongs to and what it is.</summary>
public sealed record PlannedStep(string Id, int Issue, string Environment, Step Step);

/// <summary>What became of one step on one Deployment, as deploy-&lt;id&gt;.after.json holds it.</summary>
public sealed class StepResult
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("issue")] public int Issue { get; set; }
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    /// <summary>success, failure, cut-short, not-started, in-game, or done-before.</summary>
    [JsonPropertyName("state")] public string State { get; set; } = "";
    [JsonPropertyName("code")] public int? Code { get; set; }
    [JsonPropertyName("run")] public string? Run { get; set; }
    [JsonPropertyName("inGame")] public string? InGame { get; set; }
    [JsonPropertyName("doneWhen")] public string? DoneWhen { get; set; }
    [JsonPropertyName("said")] public string Said { get; set; } = "";
}

/// <summary>What the agent keeps of each step it started on an environment.</summary>
public sealed class StepState
{
    [JsonPropertyName("state")] public string State { get; set; } = "";
    [JsonPropertyName("utc")] public string Utc { get; set; } = "";
    [JsonPropertyName("deployment")] public string Deployment { get; set; } = "";
    [JsonPropertyName("code")] public int? Code { get; set; }
}

public static class AfterDeploy
{
    /// <summary>The Release part that carries the steps.</summary>
    public const string Part = "after";
    /// <summary>The gate's verbs, in the same part.</summary>
    public const string VerbsFile = "verbs.json";
    public const int MostSteps = 10;
    static readonly Regex FileName = new(@"^([1-9][0-9]{0,5})-[a-z0-9]+(?:-[a-z0-9]+)*\.json$");
    static readonly Regex VerbName = new(@"^[A-Za-z][A-Za-z0-9-]{0,63}$");
    static readonly string[] Environments = ["dev", "main"];
    static readonly JsonSerializerOptions Strict = new() { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };

    /// <summary>The verbs verbs.json lets run after a deploy to each
    /// environment: a verb's "afterDeploy" list of environment names.</summary>
    public static Dictionary<string, HashSet<string>> AllowedVerbs(byte[] verbsJson)
    {
        using var d = JsonDocument.Parse(verbsJson);
        if (!d.RootElement.TryGetProperty("verbs", out var verbs) || verbs.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("verbs.json has no \"verbs\" object");
        var o = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var v in verbs.EnumerateObject())
        {
            if (!v.Value.TryGetProperty("afterDeploy", out var a)) continue;
            if (a.ValueKind != JsonValueKind.Array) throw new InvalidDataException($"verbs.json: {v.Name}'s afterDeploy is not a list of environments");
            var envs = new HashSet<string>(StringComparer.Ordinal);
            foreach (var e in a.EnumerateArray())
            {
                var s = e.ValueKind == JsonValueKind.String ? e.GetString()! : "";
                if (!Environments.Contains(s)) throw new InvalidDataException($"verbs.json: {v.Name}'s afterDeploy names \"{e}\", not dev or main");
                envs.Add(s);
            }
            o[v.Name] = envs;
        }
        return o;
    }

    /// <summary>Every step of every file, in file name order, held to the
    /// rules; what breaks a rule goes in errors, each naming its file, and
    /// that file's steps are left out. files is each step file's name and
    /// bytes (verbs.json among them is the gate's verbs, not a step file).</summary>
    public static List<PlannedStep> Plan(IReadOnlyDictionary<string, byte[]> files, List<string> errors)
    {
        var plan = new List<PlannedStep>();
        if (!files.TryGetValue(VerbsFile, out var verbsJson)) { errors.Add($"the steps came without {VerbsFile}, so no verb may run"); return plan; }
        Dictionary<string, HashSet<string>> allowed;
        try { allowed = AllowedVerbs(verbsJson); }
        catch (Exception e) when (e is JsonException or InvalidDataException) { errors.Add($"{VerbsFile}: {e.Message}"); return plan; }
        foreach (var name in files.Keys.Where(k => k != VerbsFile).OrderBy(k => k, StringComparer.Ordinal))
        {
            var why = new List<string>();
            var m = FileName.Match(name);
            StepFile? f = null;
            if (!m.Success) why.Add("its name is not <issue>-<a-few-words>.json, in lower case with hyphens");
            else
            {
                try { f = JsonSerializer.Deserialize<StepFile>(files[name], Strict); }
                catch (JsonException e) { why.Add("it does not read: " + e.Message); }
            }
            if (f != null)
            {
                if (f.Issue.ToString() != m.Groups[1].Value) why.Add($"its issue is {f.Issue} and its name says {m.Groups[1].Value}");
                if (!Environments.Contains(f.Environment)) why.Add($"its environment is \"{f.Environment}\", not dev or main");
                if (f.Steps.Count == 0) why.Add("it has no steps");
                if (f.Steps.Count > MostSteps) why.Add($"it has {f.Steps.Count} steps, more than {MostSteps}");
                for (int i = 0; i < f.Steps.Count; i++)
                {
                    var s = f.Steps[i];
                    var at = $"step {i + 1}";
                    if (s is null) { why.Add($"{at} is empty"); continue; }
                    if ((s.Run == null) == (s.InGame == null)) { why.Add($"{at} is not exactly one of run or inGame"); continue; }
                    if (s.Run != null)
                    {
                        if (s.DoneWhen != null) why.Add($"{at}: doneWhen belongs to an inGame step; a run step is done when its verb ends 0");
                        var line = LineProblem(s.Run);
                        if (line != "") { why.Add($"{at}: {line}"); continue; }
                        var verb = s.Run.Split(' ', 2)[0];
                        if (!allowed.TryGetValue(verb, out var envs)) why.Add($"{at}: {verb} is not a verb verbs.json lets run after a deploy (its \"afterDeploy\")");
                        else if (!envs.Contains(f.Environment)) why.Add($"{at}: verbs.json lets {verb} run after a deploy to {string.Join(" and ", envs.OrderBy(x => x))} only, not {f.Environment}");
                    }
                    else
                    {
                        var g = PlainText(s.InGame!, 10, 400);
                        if (g != "") why.Add($"{at}: inGame {g}");
                        var d = s.DoneWhen == null ? "is missing: say how the person knows it worked" : PlainText(s.DoneWhen, 5, 200);
                        if (d != "") why.Add($"{at}: doneWhen {d}");
                    }
                }
            }
            if (why.Count > 0) { foreach (var w in why) errors.Add($"{name}: {w}"); continue; }
            for (int i = 0; i < f!.Steps.Count; i++)
                plan.Add(new PlannedStep($"{name[..^5]}#{i + 1}", f.Issue, f.Environment, f.Steps[i]));
        }
        return plan;
    }

    /// <summary>"" when a gate line has the shape the gate takes
    /// (GateRules.ps1, Split-ThornswoodGateLine), or why not.</summary>
    public static string LineProblem(string line)
    {
        if (line.Length == 0) return "the run line is empty";
        if (line.Length > 600) return "the run line is over 600 characters";
        if (line.Any(c => c < 0x20 || c > 0x7E)) return "the run line holds a character outside plain printable ASCII";
        if (line.IndexOfAny(['\\', '`', '$', '<', '>', '|']) >= 0) return "the run line holds a backslash, backtick, dollar sign, angle bracket or pipe, which no verb takes";
        if (line.StartsWith(' ')) return "the run line starts with a space";
        if (!VerbName.IsMatch(line.Split(' ', 2)[0])) return "the run line does not start with a verb";
        return "";
    }

    static string PlainText(string s, int least, int most)
    {
        if (s.Trim().Length < least) return $"is shorter than {least} characters";
        if (s.Length > most) return $"is longer than {most} characters";
        if (s.Any(c => c == '\r' || c == '\n')) return "runs over more than one line";
        if (s.Contains('\u2014')) return "holds an em dash";
        return "";
    }

    /// <summary>The steps under a folder of a checkout (deploy/after) with the
    /// checkout's verbs.json, as merge-release.yml carries them.</summary>
    public static Dictionary<string, byte[]> ReadFolder(string folder, string verbsPath)
    {
        var files = new Dictionary<string, byte[]>(StringComparer.Ordinal) { [VerbsFile] = File.ReadAllBytes(verbsPath) };
        if (Directory.Exists(folder))
            foreach (var p in Directory.EnumerateFiles(folder))
            {
                var n = Path.GetFileName(p);
                if (n == "README.md") continue;
                files[n] = File.ReadAllBytes(p);
            }
        return files;
    }

    /// <summary>thornswood-agent steps: holds a checkout's steps to the
    /// rules, as a pull request's check does and the agent does again, and
    /// says each one. 0 when every file holds, 1 when one does not.</summary>
    public static int CheckCommand(string folder, string verbsPath, Action<string> say)
    {
        var errors = new List<string>();
        var plan = Plan(ReadFolder(folder, verbsPath), errors);
        foreach (var p in plan)
            say($"PASS  {p.Id} ({p.Environment}, #{p.Issue}): " + (p.Step.Run != null ? "runs " + p.Step.Run : "in game: " + p.Step.InGame));
        foreach (var e in errors) say("FAIL  " + e);
        say(plan.Count == 0 && errors.Count == 0 ? "no steps after a deploy are waiting in " + folder : $"{plan.Count} step(s) hold, {errors.Count} problem(s)");
        return errors.Count == 0 ? 0 : 1;
    }
}

/// <summary>Runs the steps of one Release on one environment after its
/// Deployment succeeded, each once, through the deploy gate (Gate.cs). The
/// gate runs one verb at a time, so a step waits up to wait for its turn.</summary>
public sealed class StepRunner(string stateDir, IGate gate, TimeSpan wait)
{
    string StatePath(string env) => Path.Combine(stateDir, $"after-{env}.json");

    public Dictionary<string, StepState> Read(string env)
    {
        var p = StatePath(env);
        if (!File.Exists(p)) return new(StringComparer.Ordinal);
        return JsonSerializer.Deserialize<Dictionary<string, StepState>>(File.ReadAllBytes(p)) ?? new(StringComparer.Ordinal);
    }

    void Keep(string env, Dictionary<string, StepState> st) =>
        Files.WriteWhole(StatePath(env), JsonSerializer.SerializeToUtf8Bytes(st, new JsonSerializerOptions { WriteIndented = true }));

    public async Task<List<StepResult>> Run(string env, IReadOnlyDictionary<string, byte[]> files, string deployment, Action<string> logf, CancellationToken ct)
    {
        var results = new List<StepResult>();
        var errors = new List<string>();
        var plan = AfterDeploy.Plan(files, errors);
        foreach (var e in errors) logf("after-deploy: NOT RUN, the file breaks a rule: " + e);
        var st = Read(env);
        foreach (var p in plan.Where(p => p.Environment == env))
        {
            var r = new StepResult { Id = p.Id, Issue = p.Issue, Kind = p.Step.Run != null ? "run" : "in-game", Run = p.Step.Run, InGame = p.Step.InGame, DoneWhen = p.Step.DoneWhen };
            results.Add(r);
            if (st.TryGetValue(p.Id, out var was))
            {
                if (was.State == "started")
                {
                    // Started and never ended: the agent stopped in the middle
                    // of it. It is not run again, so a step can never run twice.
                    r.State = "cut-short";
                    r.Said = $"started {was.Utc} on deployment {was.Deployment} and the agent stopped before it ended; not run again";
                    was.State = "cut-short";
                    Keep(env, st);
                }
                else { r.State = "done-before"; r.Said = $"{was.State} on deployment {was.Deployment}, {was.Utc}"; continue; }
                logf($"after-deploy {p.Id}: {r.Said}");
                continue;
            }
            if (p.Step.InGame != null)
            {
                st[p.Id] = new StepState { State = "in-game", Utc = Records.UtcNow(), Deployment = deployment };
                Keep(env, st);
                r.State = "in-game";
                r.Said = "for a person in the game: " + p.Step.InGame;
                logf($"after-deploy {p.Id}: {r.Said} (an issue labelled check: in game is filed for it)");
                continue;
            }
            st[p.Id] = new StepState { State = "started", Utc = Records.UtcNow(), Deployment = deployment };
            Keep(env, st);
            logf($"after-deploy {p.Id} (#{p.Issue}): {p.Step.Run}");
            var run = await gate.Run(p.Step.Run!, wait, logf, ct);
            if (!run.Taken)
            {
                // The gate never took the line, so the step never started: it
                // is taken off the record and runs with the next Deployment.
                st.Remove(p.Id);
                Keep(env, st);
                r.State = "not-started";
                r.Said = "the gate did not take the line, so it was not started; it runs with the next Deployment";
                logf($"after-deploy {p.Id}: {r.Said}");
                continue;
            }
            var code = run.Code;
            st[p.Id] = new StepState { State = code == 0 ? "success" : "failure", Utc = Records.UtcNow(), Deployment = deployment, Code = code };
            Keep(env, st);
            r.State = code == 0 ? "success" : "failure";
            r.Code = code;
            r.Said = code == 0 ? "ended 0" : $"FAILED, exit {code}";
            logf($"after-deploy {p.Id}: {r.Said}");
        }
        return results;
    }

    /// <summary>A few words for the Deployment's description: a failure
    /// first, by issue, so a cut description still shows it.</summary>
    public static (string Lead, string Tail) Summary(List<StepResult> results)
    {
        var bad = results.Where(r => r.State is "failure" or "cut-short").Select(r => r.Issue).Distinct().OrderBy(n => n).ToList();
        var ran = results.Count(r => r.State == "success");
        var later = results.Count(r => r.State == "not-started");
        var game = results.Count(r => r.State == "in-game");
        var lead = bad.Count > 0 ? "after-deploy FAILED for " + string.Join(", ", bad.Select(n => "#" + n)) + "; " : "";
        var parts = new List<string>();
        if (ran > 0) parts.Add($"{ran} after-deploy step(s) ran");
        if (game > 0) parts.Add($"{game} in-game check(s) filed");
        if (later > 0) parts.Add($"{later} wait for the gate");
        return (lead, parts.Count > 0 ? "; " + string.Join(", ", parts) : "");
    }
}
