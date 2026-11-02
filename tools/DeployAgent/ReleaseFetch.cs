#nullable enable
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Thornswood.DeployAgent;

/// <summary>manifest.json on a Release the agent applies. The Release also
/// carries manifest.cat, a catalog over manifest.json alone (New-FileCatalog,
/// version 2, SHA256) signed with ThornswoodRelease on GitHub's runner, the
/// shape release.cat has over release.json (Release-Manifest.ps1). The catalog
/// vouches for the manifest and the manifest's sha256 for every other file,
/// so one signature covers the whole Release.</summary>
public sealed class Manifest
{
    [JsonPropertyName("schema")] public int Schema { get; set; }
    [JsonPropertyName("repo")] public string Repo { get; set; } = "";
    [JsonPropertyName("commit")] public string Commit { get; set; } = "";
    [JsonPropertyName("tag")] public string Tag { get; set; } = "";
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("made")] public string Made { get; set; } = "";
    /// <summary>What the Release carries, by part: "gamemode" and "server"
    /// (the server build's zip and its record) on a build Release, "agent" on
    /// an agent Release. A part not applied yet is named in the log.</summary>
    [JsonPropertyName("parts")] public Dictionary<string, List<ManifestFile>> Parts { get; set; } = new();
}

public sealed class ManifestFile
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";
    [JsonPropertyName("size")] public long Size { get; set; }
}

/// <summary>Checks Windows signatures. On the box it is WindowsVerifier; a
/// test stands one in.</summary>
public interface IVerifier
{
    /// <summary>Throws unless cat is a catalog signed the way every launcher
    /// accepts, holding exactly the files in dir.</summary>
    void Catalog(string cat, string dir);
    /// <summary>Throws unless a program carries such a signature.</summary>
    void File(string path);
}

public sealed class SignatureException(string message) : Exception(message);

/// <summary>Holds a signed file to the check every installed launcher holds an
/// update to: launcher/app/Signature.cs (#912), compiled into the agent, for
/// the ExpectedSigner launcher/app/Updater.cs names, built in by the workflow.
/// It passes only a valid signature over every byte, with a timestamp,
/// chained to Microsoft's Identity Verification root, carrying the Artifact
/// Signing and code signing usages and Thornswood's durable identity. A
/// catalog is then held to the files it covers by Windows' own
/// Test-FileCatalog, the way Release-Manifest.ps1 holds release.json.</summary>
public sealed class WindowsVerifier : IVerifier
{
    public static string BuiltInSigner =>
        typeof(WindowsVerifier).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == "ExpectedSigner")?.Value ?? "";

    readonly string signer;
    public WindowsVerifier(string signer) { this.signer = signer; }

    void Check(string path)
    {
        if (!OperatingSystem.IsWindows()) throw new SignatureException("signatures are checked on Windows only");
        if (string.IsNullOrWhiteSpace(signer)) throw new SignatureException("this agent was built with no expected signer, so it trusts nothing");
        var why = Thornswood.Signature.Refusal(path, signer, out var said);
        if (!string.IsNullOrEmpty(why)) throw new SignatureException(Path.GetFileName(path) + " " + why);
    }

    public void File(string path) => Check(path);

    public void Catalog(string cat, string dir)
    {
        Check(cat);
        var ps = WindowsServerControl.Pwsh;
        var psi = new ProcessStartInfo(ps, ["-NoProfile", "-NonInteractive", "-Command",
            "[string](Test-FileCatalog -CatalogFilePath $env:TW_CAT -Path $env:TW_DIR)"])
        { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.Environment["TW_CAT"] = cat;
        psi.Environment["TW_DIR"] = dir;
        using var p = Process.Start(psi) ?? throw new SignatureException("PowerShell 7 did not start for Test-FileCatalog");
        var said = p.StandardOutput.ReadToEnd().Trim() + p.StandardError.ReadToEnd().Trim();
        p.WaitForExit();
        if (p.ExitCode != 0 || said != "Valid")
            throw new SignatureException($"the catalog does not hold the files as they are (Test-FileCatalog said {said})");
    }
}

/// <summary>A Release whose manifest held to its signed catalog, with the
/// files of the parts asked for downloaded and held to the manifest.</summary>
public sealed record Fetched(Manifest Manifest, string Dir, Dictionary<string, string> Files);

public static class ReleaseFetch
{
    static readonly Regex Sha256Shape = new("^[0-9a-f]{64}$");
    public static readonly Regex CommitShape = new("^[0-9a-f]{40}$");
    static readonly Regex FileNameShape = new(@"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$");

    /// <summary>Downloads manifest.json and manifest.cat into dir, checks the
    /// signature, then downloads each file of the parts named and holds it to
    /// the manifest's size and sha256. Nothing is applied here. A part in
    /// optional is fetched when the Release carries it; a file later names is
    /// left for FetchFile, when it turns out to be needed (the server build's
    /// zip, which dev does not need when it already runs that build).</summary>
    public static async Task<Fetched> Fetch(GitHub gh, IVerifier v, Release rel, string dir, string[] parts, Action<string> log, CancellationToken ct,
        string[]? optional = null, Func<string, bool>? later = null)
    {
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
        var signed = Path.Combine(dir, "signed");
        Directory.CreateDirectory(signed);
        var ma = rel.Asset("manifest.json") ?? throw new InvalidDataException($"release {rel.TagName} has no manifest.json");
        var ca = rel.Asset("manifest.cat") ?? throw new InvalidDataException($"release {rel.TagName} has no manifest.cat, so nothing on it is signed");
        if (ma.Size > 1 << 20 || ca.Size > 1 << 20) throw new InvalidDataException($"release {rel.TagName}: manifest.json or manifest.cat is over 1 MB");
        var manPath = Path.Combine(signed, "manifest.json");
        var catPath = Path.Combine(dir, "manifest.cat");
        await gh.Download(ma, manPath, ct);
        await gh.Download(ca, catPath, ct);
        try { v.Catalog(catPath, signed); }
        catch (SignatureException e) { throw new InvalidDataException($"release {rel.TagName}: the signature does not hold: {e.Message}"); }
        log("manifest.json is held by manifest.cat, signed by ThornswoodRelease");
        Manifest m;
        try { m = JsonSerializer.Deserialize<Manifest>(System.IO.File.ReadAllText(manPath)) ?? new Manifest(); }
        catch (JsonException e) { throw new InvalidDataException($"release {rel.TagName}: manifest.json does not read: {e.Message}"); }
        if (m.Schema != 1) throw new InvalidDataException($"release {rel.TagName}: manifest schema {m.Schema}, and this agent reads 1");
        if (m.Tag != rel.TagName) throw new InvalidDataException($"release {rel.TagName}: its manifest says it is \"{m.Tag}\", so it was signed for another Release");
        if (!CommitShape.IsMatch(m.Commit)) throw new InvalidDataException($"release {rel.TagName}: manifest names no 40 character commit");
        var files = Path.Combine(dir, "files");
        Directory.CreateDirectory(files);
        var got = new Dictionary<string, string>();
        foreach (var part in parts.Concat((optional ?? []).Where(m.Parts.ContainsKey)))
        {
            if (!m.Parts.TryGetValue(part, out var list) || list.Count == 0) throw new InvalidDataException($"release {rel.TagName} carries no {part}");
            var n = 0;
            foreach (var mf in list)
            {
                if (later != null && later(mf.Name)) continue;
                got[mf.Name] = await FetchFile(gh, rel, mf, files, ct);
                n++;
            }
            log($"{part}: {n} file(s), each held to the signed manifest" + (n < list.Count ? $", and {list.Count - n} left until they are needed" : ""));
        }
        return new Fetched(m, files, got);
    }

    /// <summary>Downloads one file the signed manifest lists into dir and
    /// holds it to the manifest's size and sha256.</summary>
    public static async Task<string> FetchFile(GitHub gh, Release rel, ManifestFile mf, string dir, CancellationToken ct)
    {
        if (!FileNameShape.IsMatch(mf.Name) || mf.Name is "manifest.json" or "manifest.cat")
            throw new InvalidDataException($"release {rel.TagName}: \"{mf.Name}\" is not a file name the agent takes");
        if (!Sha256Shape.IsMatch(mf.Sha256)) throw new InvalidDataException($"release {rel.TagName}: {mf.Name} has no sha256 in the manifest");
        var a = rel.Asset(mf.Name) ?? throw new InvalidDataException($"release {rel.TagName}: the manifest lists {mf.Name} and the Release does not carry it");
        if (a.Size != mf.Size) throw new InvalidDataException($"release {rel.TagName}: {mf.Name} is {a.Size} bytes on the Release and {mf.Size} in the manifest");
        var to = Path.Combine(dir, mf.Name);
        await gh.Download(a, to, ct);
        var sha = FileSha256(to);
        if (sha != mf.Sha256) throw new InvalidDataException($"release {rel.TagName}: {mf.Name} has sha256 {sha}, and the signed manifest says {mf.Sha256}");
        return to;
    }

    public static string FileSha256(string path)
    {
        using var f = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return Convert.ToHexStringLower(SHA256.HashData(f));
    }
}
