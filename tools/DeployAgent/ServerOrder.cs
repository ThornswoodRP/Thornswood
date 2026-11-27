#nullable enable
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Thornswood.DeployAgent;

/// <summary>The load order a Release's gamemode runs on, put on the server
/// with the Release (#6209).
///
/// WHY. Since #6182 the NPC catalogue is a table the box's content build
/// writes (NPC_POPULATION_DATA), and since 13 Nov 2026 the box builds it, the
/// Last plugin's recipe and every other table against the load order the
/// commit's collection record names (ContentPaths.ps1,
/// Get-ThornswoodContentOrder), moved to that record's revision. The
/// gamemode starts no NPC runtime on a server whose loadOrder is not the
/// catalogue's plugin list, name for name (npc-server-startup.ts, "Merchant
/// catalogue does not match the installed load order"). On 15 Nov 2026
/// build-1.3.72 was the first Release whose catalogue came from the box: it
/// names collection revision 8's 107 plugins, Improved Eyes Skyrim.esp among
/// them, and dev ran revision 7's 106, so the bot pass refused it at
/// merchants (Deployment 7810823306) and every dev launcher already had its
/// files.
///
/// WHAT. The order is the plugin list of the Release's own catalogue, the
/// one list the gamemode holds the server to. When the server's order is
/// another, the new order goes in with the Release, in the same stop, swap
/// and start as its plugins (Server.ApplyServerBuild), and the bot pass runs
/// on it first. A plugin the order adds is the collection's, at the bytes
/// the Release commit's records/collection-plugins.json names: on the server
/// already, or copied from the box's store of that revision
/// (CollectionStore.ps1 fills it, C:\Thornswood-Deploys\collection). A
/// plugin the order leaves out goes only when the Release commit's
/// records/collection-dropped.json names it for the revision that commit's
/// record is, with why its forms can go, the same rule the gate's
/// Deploy-DevGamemode -LoadOrder -FromRecord and Deploy-Server hold to
/// (Test-ThornswoodLoadOrderDrop). Any other is refused. Before 27 Nov 2026
/// every drop was refused here, so the first Release of a revision that took
/// a plugin out (13, without McmRecorder.esp) could reach neither server: the
/// gate's order move runs only after a Deployment is in.</summary>
public static class ServerOrder
{
    /// <summary>The catalogue table in the Release's gamemode-tables.zip.</summary>
    public const string Table = "NPC_POPULATION_DATA.json";
    /// <summary>The collection record a plugin the order adds is held to.</summary>
    public const string Record = "records/collection-plugins.json";
    public const string Settings = "server-settings.json";
    /// <summary>The plugins a collection revision takes out, and why.</summary>
    public const string DroppedRecord = "records/collection-dropped.json";

    /// <summary>The order the Release's tables name, or null when they carry
    /// no catalogue (a Release from before #6182 had it in gamemode.js, made
    /// from the committed order the server already ran).</summary>
    public static List<string>? Of(string tablesZip)
    {
        using var z = ZipFile.OpenRead(tablesZip);
        var e = z.GetEntry(Table);
        if (e == null) return null;
        using var s = e.Open();
        using var d = JsonDocument.Parse(s);
        if (d.RootElement.ValueKind != JsonValueKind.Object || !d.RootElement.TryGetProperty("plugins", out var p) || p.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException($"the Release's {Table} has no plugins list");
        var o = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var x in p.EnumerateArray())
        {
            var n = x.ValueKind == JsonValueKind.String ? x.GetString() ?? "" : "";
            if (n == "" || n.IndexOfAny(['/', '\\', ':']) >= 0 || n is "." or "..")
                throw new InvalidDataException($"the Release's {Table} names a plugin that is not a file name: \"{n}\"");
            if (!seen.Add(n)) throw new InvalidDataException($"the Release's {Table} names {n} twice");
            o.Add(n);
        }
        if (o.Count == 0) throw new InvalidDataException($"the Release's {Table} names no plugin");
        return o;
    }

    /// <summary>A plugin's file name, from a loadOrder entry ("C:/Server/plugins/X.esp", "X.esp").</summary>
    public static string NameOf(string entry) => entry.Replace('\\', '/').TrimEnd('/').Split('/')[^1];

    /// <summary>The loadOrder entries of a server's settings, as written.</summary>
    public static List<string> Entries(JsonNode settings) =>
        settings["loadOrder"] is JsonArray lo ? lo.Select(x => x?.GetValue<string>() ?? "").ToList() : new();

    /// <summary>One row of the collection record: a plugin's size and sha256.</summary>
    public sealed record Row(long Size, string Sha256);

    /// <summary>The collection record's collection, revision and rows by name.</summary>
    public sealed record Collection(string Slug, int Revision, Dictionary<string, Row> Rows);

    public static Collection ReadRecord(byte[] record)
    {
        using var d = JsonDocument.Parse(record);
        var r = d.RootElement;
        var slug = r.TryGetProperty("collection", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() ?? "" : "";
        var rev = r.TryGetProperty("revision", out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : 0;
        if (!System.Text.RegularExpressions.Regex.IsMatch(slug, "^[a-z0-9]+$") || rev < 1)
            throw new InvalidDataException($"{Record} names no collection and revision");
        if (!r.TryGetProperty("plugins", out var ps) || ps.ValueKind != JsonValueKind.Array) throw new InvalidDataException($"{Record} has no plugins list");
        var rows = new Dictionary<string, Row>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in ps.EnumerateArray())
        {
            var name = p.TryGetProperty("name", out var nv) ? nv.GetString() ?? "" : "";
            var size = p.TryGetProperty("size", out var sv) && sv.ValueKind == JsonValueKind.Number ? sv.GetInt64() : -1;
            var sha = p.TryGetProperty("sha256", out var hv) ? (hv.GetString() ?? "").ToLowerInvariant() : "";
            if (name == "" || size < 0 || !System.Text.RegularExpressions.Regex.IsMatch(sha, "^[0-9a-f]{64}$"))
                throw new InvalidDataException($"{Record} has a row without a name, a size and a sha256");
            if (!rows.TryAdd(name, new Row(size, sha))) throw new InvalidDataException($"{Record} lists {name} twice");
        }
        return new Collection(slug, rev, rows);
    }

    /// <summary>The plugins the Release commit's records/collection-dropped.json
    /// lets a server stop loading: those it names, each with why, when it is
    /// for the collection and revision of that commit's record, and none when
    /// it is for another revision or there is no such file (null).</summary>
    public static HashSet<string> MayDrop(byte[]? dropped, Collection record)
    {
        var o = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (dropped == null) return o;
        using var d = JsonDocument.Parse(dropped);
        var r = d.RootElement;
        if (r.ValueKind != JsonValueKind.Object) throw new InvalidDataException($"{DroppedRecord} is not an object");
        var slug = r.TryGetProperty("collection", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() ?? "" : "";
        var rev = r.TryGetProperty("revision", out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : 0;
        if (slug != record.Slug || rev != record.Revision) return o;
        if (!r.TryGetProperty("dropped", out var ds) || ds.ValueKind != JsonValueKind.Array) throw new InvalidDataException($"{DroppedRecord} has no dropped list");
        foreach (var x in ds.EnumerateArray())
        {
            var name = x.ValueKind == JsonValueKind.Object && x.TryGetProperty("name", out var nv) && nv.ValueKind == JsonValueKind.String ? nv.GetString() ?? "" : "";
            var why = x.ValueKind == JsonValueKind.Object && x.TryGetProperty("why", out var wv) && wv.ValueKind == JsonValueKind.String ? wv.GetString() ?? "" : "";
            if (name == "" || name.IndexOfAny(['/', '\\', ':']) >= 0 || name is "." or ".." || why.Trim() == "")
                throw new InvalidDataException($"{DroppedRecord} has a row without a plugin's file name and why it can go");
            o.Add(name);
        }
        return o;
    }

    /// <summary>What a move puts in: Files, by their path under the server's
    /// root (server-settings.json with the new loadOrder, and plugins/X for
    /// each plugin copied from the store), to the staged file; Entries, the
    /// new loadOrder as written; Added and the store it read.</summary>
    public sealed record Move(Dictionary<string, string> Files, List<string> Entries, List<string> Added, string Store);

    /// <summary>Whether the server's order is the one wanted, name for name,
    /// in the same order; the gamemode compares the same way.</summary>
    public static bool Same(IReadOnlyList<string> entries, IReadOnlyList<string> want) =>
        entries.Count == want.Count && entries.Select(NameOf).SequenceEqual(want, StringComparer.Ordinal);

    /// <summary>The plugins the server loads that want leaves out.</summary>
    public static List<string> Dropped(IReadOnlyList<string> entries, IReadOnlyList<string> want)
    {
        var w = new HashSet<string>(want, StringComparer.OrdinalIgnoreCase);
        return entries.Select(NameOf).Where(n => !w.Contains(n)).ToList();
    }

    /// <summary>Stages the move of the server at root to want: its settings
    /// with the new loadOrder, and each plugin the order adds that the server
    /// does not hold at the record's bytes, from the store. ours are the
    /// plugins the Release itself puts in (ServerPlugins), which the record
    /// does not hold. Throws InvalidDataException with the reason when the
    /// order cannot be the server's, having touched nothing of the server.
    /// mayDrop are the plugins the order may leave out (MayDrop).</summary>
    public static Move Stage(string root, IReadOnlyList<string> want, Collection record, string storeRoot, string stage, IReadOnlyCollection<string> ours, Action<string> log, IReadOnlyCollection<string>? mayDrop = null)
    {
        // Every name is joined to a folder below, so each has to be a plain
        // file name: Of holds a Release's to that, and so does any caller.
        foreach (var n in want)
            if (n == "" || n is "." or ".." || n.IndexOfAny(['/', '\\', ':']) >= 0 || Path.IsPathRooted(n) || Path.GetFileName(n) != n)
                throw new InvalidDataException($"the order names a plugin that is not a file name: \"{n}\"");
        var settingsPath = Path.Combine(root, Settings);
        var settings = JsonNode.Parse(File.ReadAllText(settingsPath).TrimStart('\uFEFF'))?.AsObject()
            ?? throw new InvalidDataException("the server's server-settings.json is not an object");
        var entries = Entries(settings);
        var dropped = Dropped(entries, want);
        var let = mayDrop ?? Array.Empty<string>();
        var refused = dropped.Where(x => !let.Contains(x, StringComparer.OrdinalIgnoreCase)).ToList();
        if (refused.Count > 0)
            throw new InvalidDataException($"the Release's order leaves out {string.Join(", ", refused)}, which the server loads; a plugin a collection revision takes out is named, with why its forms can go, in {DroppedRecord} for {record.Slug} revision {record.Revision}");
        foreach (var x in dropped.Except(refused, StringComparer.OrdinalIgnoreCase))
            log($"load order: {x} leaves the server's order: {DroppedRecord} takes it out with {record.Slug} revision {record.Revision}");
        var have = entries.ToDictionary(NameOf, e => e, StringComparer.OrdinalIgnoreCase);
        var plugins = Path.Combine(root, ServerPlugins.Dir);
        // A new entry is written the way the server's entries for its plugins
        // folder are (Deploy-DevGamemode.ps1 writes full paths with forward
        // slashes); a server with none gets the full path the same way.
        var prefix = entries.Where(e => e.Replace('\\', '/').EndsWith("/" + ServerPlugins.Dir + "/" + NameOf(e), StringComparison.OrdinalIgnoreCase) &&
                                        File.Exists(Path.Combine(plugins, NameOf(e))))
                            .Select(e => e[..^NameOf(e).Length]).FirstOrDefault()
            ?? plugins.Replace('\\', '/').TrimEnd('/') + "/";
        var store = Path.Combine(storeRoot, record.Slug + "-" + record.Revision);
        var files = new Dictionary<string, string>(StringComparer.Ordinal);
        var added = new List<string>();
        var newEntries = new List<string>();
        foreach (var n in want)
        {
            if (have.TryGetValue(n, out var e)) { newEntries.Add(e); continue; }
            added.Add(n);
            newEntries.Add(prefix + n);
            if (ours.Contains(n, StringComparer.OrdinalIgnoreCase))
            {
                if (!File.Exists(Path.Combine(plugins, n))) throw new InvalidDataException($"the Release's order names {n}, which neither the server nor the Release has");
                continue;
            }
            if (!record.Rows.TryGetValue(n, out var row))
                throw new InvalidDataException($"the Release's order names {n}, which the collection record of its commit ({Record}, {record.Slug} revision {record.Revision}) does not");
            var on = Path.Combine(plugins, n);
            if (Is(on, row)) { log($"load order: {n} is on the server already, the record's bytes"); continue; }
            var from = Path.Combine(store, n);
            if (!Is(from, row))
                throw new InvalidDataException($"the Release's order adds {n}, which is not on the server or in the box's store of {record.Slug} revision {record.Revision} ({store}) at the record's sha256 {row.Sha256[..12]}; the gate's Deploy-DevGamemode -LoadOrder -FromRecord fills the store");
            var to = Path.Combine(stage, ServerPlugins.Dir, n);
            Directory.CreateDirectory(Path.GetDirectoryName(to)!);
            Files.Copy(from, to);
            if (!Is(to, row)) throw new InvalidDataException($"{n} copied from the store is not the record's bytes");
            files[ServerPlugins.Dir + "/" + n] = to;
            log($"load order: {n} from the box's store of {record.Slug} revision {record.Revision}, {row.Size:N0} bytes, sha256 {row.Sha256[..12]}");
        }
        settings["loadOrder"] = new JsonArray(newEntries.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray());
        // A plugin the record lets go is one whose forms can go, and the
        // engine is told so by forgetPlugins: a save that still names one of
        // its forms (an item, a head part) then loads without it, where it
        // otherwise stops the server, "X is 827:McmRecorder.esp, but
        // McmRecorder.esp is not in the server's load order" (main, build-
        // 1.3.136, 27 Nov 2026). The names stay there once written, since a
        // save not loaded yet may still name them, and a plugin the order
        // loads again leaves it: the engine refuses one it loads.
        var forget = settings["forgetPlugins"] is JsonArray fa
            ? fa.Select(x => x?.GetValue<string>() ?? "").Where(x => x != "").ToList()
            : new List<string>();
        foreach (var x in dropped.Except(refused, StringComparer.OrdinalIgnoreCase))
            if (!forget.Contains(x, StringComparer.OrdinalIgnoreCase))
            {
                forget.Add(x);
                log($"load order: {x} goes in forgetPlugins, so a save that names one of its forms loads without it");
            }
        foreach (var x in forget.Where(x => want.Contains(x, StringComparer.OrdinalIgnoreCase)).ToList())
        {
            forget.Remove(x);
            log($"load order: {x} leaves forgetPlugins, since the order loads it again");
        }
        if (forget.Count > 0) settings["forgetPlugins"] = new JsonArray(forget.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray());
        else settings.Remove("forgetPlugins");
        var staged = Path.Combine(stage, Settings);
        Directory.CreateDirectory(stage);
        Files.WriteWhole(staged, JsonSerializer.SerializeToUtf8Bytes(settings, new JsonSerializerOptions { WriteIndented = true }));
        files[Settings] = staged;
        return new Move(files, newEntries, added, store);
    }

    static bool Is(string path, Row row)
    {
        var f = new FileInfo(path);
        if (!f.Exists || f.Length != row.Size) return false;
        using var s = Files.OpenShared(path);
        return Convert.ToHexStringLower(SHA256.HashData(s)) == row.Sha256;
    }
}
