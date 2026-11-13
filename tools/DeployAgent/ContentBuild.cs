#nullable enable
// The content build (#5191, stage 3). Nothing generated is committed (Patrick's
// B on #5191, 1 Nov 2026): the content plugin and every table read out of the
// load order are built on this box, where the whole load order is, by the
// gate's Build-Content verb (scripts/mods/Build-ContentOnBox.ps1), and kept
// by their inputs. The merge release, on GitHub's runner, has no game data,
// so it takes them from a draft Release on this repository (Patrick's B on
// q-5191-box-build-upload, 12 Nov 2026), named by the inputs it was built
// from: content-<server>-<key>.
//
// A merge whose inputs have no such draft makes a Deployment to "Content"
// carrying the key it looked for. The agent has the gate build it, holds the
// kept build to its build.json, puts it on the draft, and says how it went;
// that status starts the merge release again.
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Thornswood.DeployAgent;

public sealed class ContentBuild(EnvConfig env, GitHub writer, IGate gate, string workRoot)
{
    /// <summary>The environment's kind and its name in agent.json.</summary>
    public const string Kind = "content";
    /// <summary>The build's files at their repository paths, and its record.</summary>
    public const string ZipName = "content.zip";
    public const string RecordName = "content-build.json";
    /// <summary>How many drafts of each server are kept, the newest. Build-Content
    /// keeps 8 on the box; the drafts keep more, so a release of an older
    /// commit (a rerun) still finds its build.</summary>
    public const int Keep = 16;
    /// <summary>How long the gate's turn is waited for: it runs one verb at a time.</summary>
    public static readonly TimeSpan GateWait = TimeSpan.FromMinutes(30);

    static readonly Regex KeyShape = new("^[0-9a-f]{64}$");
    static readonly Regex CommitShape = new("^[0-9a-f]{40}$");
    static readonly Regex Made = new(@"^(BUILT|REUSED) ([0-9a-f]{64})$");
    static readonly Regex From = new(@"^FROM ([0-9a-f]{40})$");

    public static string Tag(string server, string key) => $"content-{server}-{key}";

    /// <summary>The key and the server a Deployment to Content asks for.</summary>
    public static (string Key, string Server) Payload(JsonElement payload)
    {
        var p = payload;
        if (p.ValueKind == JsonValueKind.String)
        {
            using var d = JsonDocument.Parse(p.GetString() ?? "");
            p = d.RootElement.Clone();
        }
        string S(string n) => p.ValueKind == JsonValueKind.Object && p.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
        var key = S("content");
        var server = S("server");
        if (!KeyShape.IsMatch(key)) throw new InvalidDataException("the Deployment has no payload naming a content key (64 hex)");
        if (server is not ("dev" or "main")) throw new InvalidDataException($"the Deployment's server is \"{server}\", not dev or main");
        return (key, server);
    }

    /// <summary>Builds what the Deployment asks for and puts it on its draft.
    /// The gate builds from main as it is now, which may be past the
    /// Deployment's commit: what is put up is named by what was built, and
    /// the merge release of the newest commit looks for its own key.</summary>
    public async Task<Outcome> Apply(Deployment d, Action<string> logf, CancellationToken ct)
    {
        var (asked, server) = Payload(d.Payload);
        logf($"content build for {server}, inputs {asked[..12]}, asked by commit {Short(d.Sha)}");
        var run = await gate.Run($"Build-Content -Server {server}", GateWait, logf, ct);
        if (!run.Taken) return new Outcome("error", "not built: " + run.Lines.LastOrDefault());
        if (run.Code != 0) return new Outcome("failure", $"not built: Build-Content ended with exit {run.Code}: " + run.Lines.LastOrDefault(l => l.StartsWith("STOP.", StringComparison.Ordinal)));
        var key = run.Lines.Select(l => Made.Match(l)).Where(m => m.Success).Select(m => m.Groups[2].Value).LastOrDefault() ?? "";
        var commit = run.Lines.Select(l => From.Match(l)).Where(m => m.Success).Select(m => m.Groups[1].Value).LastOrDefault() ?? "";
        if (key == "" || commit == "") return new Outcome("failure", "not built: Build-Content did not say BUILT or REUSED with its key, and FROM with its commit");

        var dir = Path.Combine(env.Root, server, key);
        var (files, why) = Read(dir, key, server);
        if (files == null) return new Outcome("failure", $"not put up: the build kept as {key[..12]} {why}");
        logf($"build {key[..12]} of {Short(commit)}: {files.Count} files, held to its build.json");

        var tag = Tag(server, key);
        var work = Path.Combine(workRoot, "content-" + d.Id);
        if (Directory.Exists(work)) Directory.Delete(work, true);
        Directory.CreateDirectory(work);
        try
        {
            var zip = Path.Combine(work, ZipName);
            Zip(dir, files, zip);
            var record = Path.Combine(dir, "build.json");
            var drafts = await writer.Drafts($"content-{server}-", ct);
            var there = drafts.FirstOrDefault(r => r.TagName == tag);
            if (there != null && there.Asset(ZipName) != null && there.Asset(RecordName) != null)
                logf($"the draft {tag} is up already");
            else
            {
                // One cut short (an upload that failed) is made again whole.
                if (there != null) { await writer.DeleteRelease(there.Id, ct); drafts.Remove(there); logf($"the draft {tag} was not whole and was taken down"); }
                var rel = await writer.CreateDraft(tag, commit, $"Content build {key[..12]} ({server})",
                    $"The content plugin and every table read out of the load order, built on the box from {commit} against the {server} server's plugins, kept by their inputs (#5191). Never published: the merge release takes it.", ct);
                await writer.Upload(rel, ZipName, zip, ct);
                await writer.Upload(rel, RecordName, record, ct);
                rel.CreatedAt = DateTimeOffset.UtcNow;
                drafts.Add(rel);
                logf($"put up as the draft {tag}");
            }
            foreach (var old in drafts.Where(r => r.TagName != tag).OrderByDescending(r => r.CreatedAt).Skip(Keep - 1))
            {
                await writer.DeleteRelease(old.Id, ct);
                logf($"took down the older draft {old.TagName}");
            }
        }
        catch (Exception e) when (e is GitHubException or HttpRequestException or TaskCanceledException or IOException)
        {
            if (ct.IsCancellationRequested) throw;
            return new Outcome("error", $"built {key[..12]}, not put up: " + e.Message);
        }
        // What was put up stands whatever becomes of the work folder; a
        // folder left behind is said in the log.
        finally { try { Directory.Delete(work, true); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { logf($"the work folder {work} was not removed: {e.Message}"); } }
        var moved = key == asked ? "" : $"; main had moved on, so its inputs are not the {asked[..12]} asked for";
        return new Outcome("success", $"built {key[..12]} from {Short(commit)}" + moved);
    }

    /// <summary>A kept build's files, each held to the sha256 its build.json
    /// names, or null and why not. Paths are the repository's, never rooted
    /// and never climbing out.</summary>
    public static (SortedDictionary<string, string>? Files, string Why) Read(string dir, string key, string server)
    {
        var rec = Path.Combine(dir, "build.json");
        if (!File.Exists(rec)) return (null, "has no build.json on the box");
        JsonElement b;
        try { using var doc = JsonDocument.Parse(File.ReadAllBytes(rec)); b = doc.RootElement.Clone(); }
        catch (JsonException e) { return (null, "has a build.json that does not read: " + e.Message); }
        string S(string n) => b.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
        if (S("key") != key || S("server") != server) return (null, "has a build.json for another key or server");
        if (!CommitShape.IsMatch(S("commit"))) return (null, "has a build.json naming no commit");
        if (!b.TryGetProperty("files", out var fs) || fs.ValueKind != JsonValueKind.Object) return (null, "has a build.json naming no files");
        var files = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var f in fs.EnumerateObject())
        {
            var name = f.Name;
            if (name == "" || name.StartsWith('/') || name.Contains('\\') || name.Contains(':') || name.Split('/').Any(w => w is "" or "." or "..") || Path.IsPathRooted(name))
                return (null, $"names a file \"{name}\" outside the repository");
            var want = f.Value.ValueKind == JsonValueKind.String ? f.Value.GetString()! : "";
            var p = Path.Combine(dir, "files", name.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(p)) return (null, $"is missing {name}");
            if (Sha256(p) != want) return (null, $"has {name} not as its build.json says");
            files[name] = want;
        }
        if (files.Count == 0) return (null, "names no files");
        return (files, "");
    }

    /// <summary>The build's files at their repository paths, in path order
    /// with one time on every entry, so the same build is the same zip.</summary>
    static void Zip(string dir, SortedDictionary<string, string> files, string to)
    {
        using var z = ZipFile.Open(to, ZipArchiveMode.Create);
        foreach (var name in files.Keys)
        {
            var e = z.CreateEntry(name, CompressionLevel.Optimal);
            e.LastWriteTime = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
            using var dst = e.Open();
            using var src = File.OpenRead(Path.Combine(dir, "files", name.Replace('/', Path.DirectorySeparatorChar)));
            src.CopyTo(dst);
        }
    }

    static string Sha256(string path)
    {
        using var s = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(s)).ToLowerInvariant();
    }

    static string Short(string sha) => sha.Length > 7 ? sha[..7] : sha;
}
