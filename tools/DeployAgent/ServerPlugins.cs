#nullable enable
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;

namespace Thornswood.DeployAgent;

/// <summary>A game server's own two plugins, Thornswood-Content.esp and
/// Thornswood-Last.esp, from the Release being applied (#6175).
///
/// WHY. Since #6110 a Release's game files carry the content plugin and the
/// Last plugin's recipe from the box's content build, and every launcher on
/// that Release holds the server to them byte for byte (Verify.Bytes). The
/// agent put in a Release's gamemode, tables and server build and never its
/// plugins, so on 15 Nov 2026 main took build-1.3.69 with the box's tables
/// over the committed plugins it had before (Thornswood-Content.esp
/// d60f6410 where the Release has 44b5c798, the Last plugin of recipe
/// 9834efe6 where the Release's is 57d80e30), and every launcher on main
/// refused Play.
///
/// WHAT. The content plugin is the Release's own file. The Last plugin is
/// never carried by anything (LastPluginOnBox.ps1 says why): it is made here
/// from the Release's recipe, out of the content plugin just staged and the
/// server's other plugins, with the string tables of the box's game archive
/// store, by the launcher's own LastPlugin.Apply, compiled in from where it
/// lives, so the server's copy is the one every launcher makes. A recipe
/// that cannot be made from the server's plugins makes nothing, and the
/// Release is not applied.</summary>
public static class ServerPlugins
{
    public const string Content = "Thornswood-Content.esp";
    public const string Last = "Thornswood-Last.esp";
    /// <summary>The game part's files (merge-release.yml, Pack-Game).</summary>
    public const string GameZip = "game.zip";
    public const string GameFiles = "game-files.json";
    /// <summary>The Release part they are in.</summary>
    public const string Part = "game";
    const string ContentIn = "Data/" + Content;
    const string RecipeIn = "Data/Thornswood-Last.recipe";
    /// <summary>Where a server keeps its plugins (Deploy-Server.ps1, $remotePlugins).</summary>
    public const string Dir = "plugins";

    /// <summary>What a Release puts in a server's plugins folder.</summary>
    public sealed record Want(byte[] ContentBytes, byte[] Recipe, string ContentSha, string LastSha, long LastSize);

    /// <summary>Whether the game part's list names the content plugin, which
    /// a Release from before #6110 does as well: its copy is the committed one.</summary>
    public static bool Lists(byte[] gameFiles) => Listed(gameFiles).ContainsKey(ContentIn);

    static Dictionary<string, (long size, string sha)> Listed(byte[] gameFiles)
    {
        using var d = JsonDocument.Parse(gameFiles);
        var o = new Dictionary<string, (long, string)>(StringComparer.Ordinal);
        if (!d.RootElement.TryGetProperty("files", out var fs) || fs.ValueKind != JsonValueKind.Array) throw new InvalidDataException("game-files.json has no files list");
        foreach (var f in fs.EnumerateArray())
        {
            var p = f.TryGetProperty("path", out var pv) ? pv.GetString() ?? "" : "";
            var s = f.TryGetProperty("sha256", out var sv) ? sv.GetString() ?? "" : "";
            var n = f.TryGetProperty("size", out var nv) && nv.ValueKind == JsonValueKind.Number ? nv.GetInt64() : -1;
            if (p != "") o[p] = (n, s.ToLowerInvariant());
        }
        return o;
    }

    /// <summary>The content plugin and the recipe out of game.zip, each held
    /// to the size and sha256 game-files.json names (game-files.json is held
    /// to the signed manifest by ReleaseFetch). Throws InvalidDataException
    /// when either is missing or is not the listed file.</summary>
    public static Want Read(string gameZip, byte[] gameFiles)
    {
        var list = Listed(gameFiles);
        using var z = ZipFile.OpenRead(gameZip);
        byte[] Take(string path)
        {
            if (!list.TryGetValue(path, out var want)) throw new InvalidDataException($"the Release's game-files.json does not list {path}");
            var e = z.GetEntry(path) ?? throw new InvalidDataException($"the Release's game.zip has no {path}");
            using var s = e.Open();
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            var b = ms.ToArray();
            if (b.LongLength != want.size || Sha(b) != want.sha)
                throw new InvalidDataException($"the Release's {path} is not the file its game-files.json names ({b.LongLength} bytes, sha256 {Sha(b)[..12]})");
            return b;
        }
        var content = Take(ContentIn);
        var recipe = Take(RecipeIn);
        Thornswood.LastPlugin.Header h;
        try { h = Thornswood.LastPlugin.ReadHeader(recipe); }
        catch (Thornswood.LastPlugin.CannotMake e) { throw new InvalidDataException("the Release's Thornswood-Last.recipe does not read: " + e.Message); }
        return new Want(content, recipe, Sha(content), Convert.ToHexStringLower(h.Sha256), h.Size);
    }

    /// <summary>Which of the two the server's plugins folder does not hold as
    /// the Release has them, by name; empty when both are.</summary>
    public static List<string> Differ(string root, Want w)
    {
        var o = new List<string>();
        if (FileSha(Path.Combine(root, Dir, Content)) != w.ContentSha) o.Add(Content);
        if (FileSha(Path.Combine(root, Dir, Last)) != w.LastSha) o.Add(Last);
        return o;
    }

    /// <summary>Writes the Release's content plugin and the Last plugin made
    /// from its recipe into stage\plugins, and returns them as repository
    /// style paths under the server's root ("plugins/Thornswood-Content.esp")
    /// to the staged files. The Last plugin reads the staged content plugin
    /// first, then the server's own plugins; its string tables come loose or
    /// out of the archives of gameData and then of those folders, in name
    /// order as if they were one Data folder (last_recipe.py, Folders).
    /// Throws InvalidDataException with the reason when it cannot be made.</summary>
    public static Dictionary<string, string> Stage(string root, string stage, Want w, string gameData, Action<string> log)
    {
        var into = Path.Combine(stage, Dir);
        Directory.CreateDirectory(into);
        var content = Path.Combine(into, Content);
        Files.WriteWhole(content, w.ContentBytes);
        var datas = new[] { into, Path.Combine(root, Dir) };
        var tables = new[] { gameData }.Concat(datas).Where(d => d != "").ToArray();
        byte[] made;
        try { made = Thornswood.LastPlugin.Apply(w.Recipe, s => s.IsTable ? Table(tables, s.Name) : Plugin(datas, s.Name)); }
        catch (Thornswood.LastPlugin.CannotMake e) { throw new InvalidDataException($"{Last} could not be made from the Release's recipe on this server: {e.Message}"); }
        var last = Path.Combine(into, Last);
        Files.WriteWhole(last, made);
        log($"plugins: {Content} {w.ContentBytes.Length:N0} bytes, sha256 {w.ContentSha[..12]}, from the Release; {Last} {made.Length:N0} bytes, sha256 {w.LastSha[..12]}, made from its recipe");
        return new() { [Dir + "/" + Content] = content, [Dir + "/" + Last] = last };
    }

    static Stream? Plugin(string[] datas, string name)
    {
        foreach (var d in datas)
        {
            var p = Path.Combine(d, name);
            if (File.Exists(p)) return new MemoryStream(File.ReadAllBytes(p));
        }
        return null;
    }

    static Stream? Table(string[] folders, string name)
    {
        foreach (var d in folders)
        {
            var p = Path.Combine(d, "Strings", name);
            if (File.Exists(p)) return new MemoryStream(File.ReadAllBytes(p));
        }
        // Every archive of them all, by name, the first folder's copy of a
        // name winning (last_recipe.py, Folders.archives).
        var seen = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var d in folders.Where(Directory.Exists))
            foreach (var p in Directory.EnumerateFiles(d))
            {
                var n = Path.GetFileName(p);
                if (n.EndsWith(".bsa", StringComparison.OrdinalIgnoreCase) && !seen.ContainsKey(n)) seen[n] = p;
            }
        var rel = "strings\\" + name;
        foreach (var a in seen.Values)
        {
            Thornswood.GameArchive arc;
            try { arc = new Thornswood.GameArchive(a); }
            catch (Exception e) when (e is InvalidDataException or EndOfStreamException or ArgumentException or IndexOutOfRangeException or IOException) { continue; }
            if (arc.Has(rel)) return new MemoryStream(arc.Read(rel));
        }
        return null;
    }

    static string Sha(byte[] b) => Convert.ToHexStringLower(SHA256.HashData(b));

    static string FileSha(string p)
    {
        if (!File.Exists(p)) return "";
        using var f = Files.OpenShared(p);
        return Convert.ToHexStringLower(SHA256.HashData(f));
    }
}
