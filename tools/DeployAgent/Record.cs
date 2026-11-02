#nullable enable
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Thornswood.DeployAgent;

/// <summary>The record every deploy leaves (scripts/deploy/Artifact.ps1,
/// New-ThornswoodDeployRecord), in the same shape, so the site's /api/deploys
/// and http://&lt;box&gt;:7788/thornswood-deploy.json say what the agent put in
/// exactly as they say what a deploy script put in.</summary>
public sealed class DeployRecord
{
    [JsonPropertyName("part")] public string Part { get; set; } = "";
    [JsonPropertyName("component")] public string Component { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("commit")] public string Commit { get; set; } = "";
    [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";
    [JsonPropertyName("size")] public long Size { get; set; }
    [JsonPropertyName("files")] public int Files { get; set; }
    [JsonPropertyName("root")] public string Root { get; set; } = "";
    [JsonPropertyName("deployedUtc")] public string DeployedUtc { get; set; } = "";
    [JsonPropertyName("from")] public string From { get; set; } = "";
}

public static class Records
{
    static readonly Regex PartShape = new(@"^[A-Za-z0-9][A-Za-z0-9._-]*$");
    static readonly Regex LogName = new(@"^deploy-([A-Za-z0-9._-]+)\.log$");

    /// <summary>The folder's leaf in lower case, as Get-ThornswoodArtifactPart names a part.</summary>
    public static string PartName(string root)
    {
        var leaf = root.Replace('\\', '/').TrimEnd('/').Split('/')[^1];
        if (!PartShape.IsMatch(leaf)) throw new ArgumentException($"cannot name a part after the folder {root}");
        return leaf.ToLowerInvariant();
    }

    /// <summary>Leaves the record beside what the server runs, in the store's
    /// current\&lt;part&gt;.json and a line in history.log. The server already runs
    /// the new gamemode by then, so a record that cannot be written is said in
    /// the log and does not undo the deploy.</summary>
    public static void Write(Server s, DeployRecord rec, Action<string> log)
    {
        string beside;
        try { beside = Path.Combine(s.DataDir(), "thornswood-deploy.json"); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException) { log("RECORD NOT WRITTEN: " + e.Message); return; }
        WriteAt(s.Env.Root, beside, s.Env.Store, rec, log);
    }

    /// <summary>The same record for an app (the site, the bot): beside it as
    /// &lt;root&gt;\thornswood-deploy.json, where Set-ThornswoodArtifactCurrent
    /// leaves it, and in the store.</summary>
    public static void WriteBeside(string root, string store, DeployRecord rec, Action<string> log) =>
        WriteAt(root, Path.Combine(root, "thornswood-deploy.json"), store, rec, log);

    static void WriteAt(string root, string beside, string store, DeployRecord rec, Action<string> log)
    {
        try
        {
            rec.Part = PartName(root);
            rec.Root = root.Replace('\\', '/');
            var b = JsonSerializer.SerializeToUtf8Bytes(rec, new JsonSerializerOptions { WriteIndented = true });
            Files.WriteWhole(beside, b);
            if (store == "") return;
            Files.WriteWhole(Path.Combine(store, "current", rec.Part + ".json"), b);
            File.AppendAllText(Path.Combine(store, "history.log"), $"{rec.DeployedUtc} {rec.Part} {rec.Name} from {rec.From}\r\n");
            log($"the box records {rec.Part} as {rec.Name}");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException)
        {
            log("RECORD NOT WRITTEN: " + e.Message);
        }
    }

    /// <summary>Leaves a deploy's log in the server's data folder, served on
    /// its resources port, as deploy-&lt;id&gt;.log, the newest ten kept, and
    /// hands back the address a Deployment's log_url names ("" when none).
    /// Addresses in server.log lines are taken out before they reach it.</summary>
    public static string PublishLog(Server s, string id, IEnumerable<string> lines)
    {
        string dir;
        try { dir = s.DataDir(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException) { return ""; }
        return PublishLog(dir, s.Env.LogBase, id, lines);
    }

    /// <summary>The same for an app's Deployment: into its LogDir, which
    /// Install-DeployAgent.ps1 points at the dev server's data folder (the one
    /// folder on the box served to the outside), named by the Deployment.</summary>
    public static string PublishLog(string dir, string logBase, string id, IEnumerable<string> lines)
    {
        if (dir == "") return "";
        var name = $"deploy-{id}.log";
        try
        {
            Files.WriteWhole(Path.Combine(dir, name), Encoding.UTF8.GetBytes(string.Join("\r\n", lines) + "\r\n"));
            var old = new DirectoryInfo(dir).EnumerateFiles("deploy-*.log").Where(f => LogName.IsMatch(f.Name))
                .OrderByDescending(f => f.LastWriteTimeUtc).Skip(10);
            foreach (var f in old) f.Delete();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return ""; }
        return logBase == "" ? "" : logBase.TrimEnd('/') + "/" + name;
    }

    static readonly Regex StepsName = new(@"^deploy-([A-Za-z0-9._-]+)\.after\.json$");

    /// <summary>Leaves what became of each step after a deploy (#5186) beside
    /// the deploy's log, as deploy-&lt;id&gt;.after.json, the newest ten kept.
    /// .github/workflows/after-deploy.yml reads it from the address beside
    /// the log's. A file that cannot be written is said in the log already
    /// published; the steps ran either way.</summary>
    public static void PublishSteps(Server s, string id, string commit, List<StepResult> steps)
    {
        var dir = s.DataDir();
        try
        {
            var body = new Dictionary<string, object> { ["format"] = 1, ["deployment"] = id, ["commit"] = commit, ["steps"] = steps };
            Files.WriteWhole(Path.Combine(dir, $"deploy-{id}.after.json"), JsonSerializer.SerializeToUtf8Bytes(body, new JsonSerializerOptions { WriteIndented = true }));
            var old = new DirectoryInfo(dir).EnumerateFiles("deploy-*.after.json").Where(f => StepsName.IsMatch(f.Name))
                .OrderByDescending(f => f.LastWriteTimeUtc).Skip(10);
            foreach (var f in old) f.Delete();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    public static string UtcNow() => DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");
}
