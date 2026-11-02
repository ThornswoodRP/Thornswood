#nullable enable
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Thornswood.DeployAgent;

/// <summary>The gamemode's tables (#5191): every table a builder reads out of
/// the load order is its own file, game/gamemode-tables/&lt;NAME&gt;.json, which
/// the gamemode reads from &lt;root&gt;\gamemode-tables once a load and names in
/// server.log by the git tree id of the folder, beside the blob of
/// gamemode.js. A Release carries the folder as gamemode-tables.zip in its
/// gamemode part, held to the signed manifest like the other files.</summary>
public static class Tables
{
    public const string Zip = "gamemode-tables.zip";
    public const string Dir = "gamemode-tables";
    static readonly Regex Name = new(@"^[A-Z][A-Z0-9_]*\.json$");

    /// <summary>The table files of a folder, by name in git's order.</summary>
    static List<string> Names(string dir) =>
        Directory.EnumerateFiles(dir).Select(Path.GetFileName).Where(n => Name.IsMatch(n!)).Select(n => n!)
            .OrderBy(n => n, StringComparer.Ordinal).ToList();

    /// <summary>The git tree id of a folder's table files, worked out the way
    /// the gamemode works it out as it loads (game/gamemode.js, tableFolder):
    /// each file's blob as GamemodeBlob gives it, then git's tree hash. ""
    /// when there is no folder, which is a gamemode from before #5191.</summary>
    public static string Tree(string dir)
    {
        if (!Directory.Exists(dir)) return "";
        using var body = new MemoryStream();
        foreach (var n in Names(dir))
        {
            var head = Encoding.UTF8.GetBytes("100644 " + n + "\0");
            body.Write(head);
            body.Write(Convert.FromHexString(Files.GamemodeBlob(Path.Combine(dir, n))));
        }
        var b = body.ToArray();
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA1);
        sha.AppendData(Encoding.ASCII.GetBytes($"tree {b.Length}\0"));
        sha.AppendData(b);
        return Convert.ToHexStringLower(sha.GetHashAndReset());
    }

    /// <summary>The line a gamemode that reads tables logs as it loads, after
    /// its blob (game/gamemode.js, tableFolder).</summary>
    public const string TreeSaid = "gamemode tables are git tree ";

    /// <summary>Whether this gamemode.js reads tables, so its load is held to
    /// their tree: it carries the line that names them. One from before #5191
    /// does not, whatever folder sits beside it.</summary>
    public static bool Reads(string gamemode) =>
        File.Exists(gamemode) && File.ReadAllText(gamemode).Contains(TreeSaid, StringComparison.Ordinal);

    /// <summary>The table files in a folder, for a count in the log.</summary>
    public static int Count(string dir) => Directory.Exists(dir) ? Names(dir).Count : 0;

    /// <summary>Expands the Release's zip into dir. Every entry has to be a
    /// table at the top of the zip, named like the constant that holds it, so
    /// nothing in it can land anywhere else or be a file the gamemode does not
    /// read. Returns how many tables it wrote.</summary>
    public static int Expand(string zip, string dir)
    {
        Directory.CreateDirectory(dir);
        var n = 0;
        using var za = ZipFile.OpenRead(zip);
        foreach (var ze in za.Entries)
        {
            if (ze.FullName.EndsWith('/') && ze.Length == 0) throw new InvalidDataException($"{Zip} holds a folder, {ze.FullName}, and the tables are files at its top");
            if (!Name.IsMatch(ze.FullName)) throw new InvalidDataException($"{Zip} holds {ze.FullName}, which is not a table named like its constant");
            var to = Path.Combine(dir, ze.FullName);
            using (var s = ze.Open())
            using (var f = new FileStream(to, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                s.CopyTo(f);
                f.Flush(true);
            }
            n++;
        }
        if (n == 0) throw new InvalidDataException($"{Zip} holds no tables");
        return n;
    }

    /// <summary>A copy of a folder's table files, for the .prev copy a put-back reads.</summary>
    public static void CopyDir(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var n in Names(from)) Files.Copy(Path.Combine(from, n), Path.Combine(to, n));
    }
}
