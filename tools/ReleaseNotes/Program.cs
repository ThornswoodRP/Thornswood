namespace Thornswood.ReleaseNotes;

/// <summary>thornswood-notes. Exit codes: 0 the note is right, 1 it is not (each
/// problem on a STOP line), 2 a usage mistake or a file that cannot be read.</summary>
public static class Program
{
    const string Usage = """
        thornswood-notes pr --body-file <file> [--author <login>]

        pr     the "Release note:" line of a pull request body, as the
               "Release note" check (.github/workflows/pr-body.yml) holds it:
               there is one, and it says none or is a note a release can
               carry as written
        """;

    public static int Main(string[] args) => Run(args, Console.Out);

    internal static int Run(string[] args, TextWriter o)
    {
        if (args.Length == 0 || args[0] is "-h" or "--help" or "help") { o.WriteLine(Usage); return args.Length == 0 ? 2 : 0; }
        var verb = args[0];
        var rest = args[1..];
        try
        {
            return verb switch
            {
                "pr" => Pr(rest, o),
                _ => UsageMistake(o, $"not understood: {string.Join(' ', args)}"),
            };
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            o.WriteLine($"STOP  {e.Message}");
            return 2;
        }
    }

    static int UsageMistake(TextWriter o, string what) { o.WriteLine($"{what}\n\n{Usage}"); return 2; }

    static int Pr(string[] rest, TextWriter o)
    {
        string? bodyFile = null, author = "";
        for (int i = 0; i < rest.Length; i++)
        {
            if (rest[i] == "--body-file" && i + 1 < rest.Length) bodyFile = rest[++i];
            else if (rest[i] == "--author" && i + 1 < rest.Length) author = rest[++i];
            else return UsageMistake(o, $"not understood: {rest[i]}");
        }
        if (bodyFile is null) return UsageMistake(o, "pr needs --body-file");
        if (!File.Exists(bodyFile)) { o.WriteLine($"STOP  no body file at {bodyFile}"); return 1; }
        var body = File.ReadAllText(bodyFile);

        var problems = PrNote.Problems(body, author);
        if (problems.Length > 0)
        {
            foreach (var p in problems) o.WriteLine($"STOP  release note: {p}");
            o.WriteLine("Edit the pull request body and this check runs again by itself. docs/guide/release-to-dev.md, \"Say so, then write the note\", has the shape.");
            return 1;
        }
        var n = PrNote.Read(body);
        if (string.Equals(author, "dependabot[bot]", StringComparison.OrdinalIgnoreCase)) o.WriteLine("PASS  release note: none, by rule for a Dependabot pull request");
        else if (n.None) o.WriteLine("PASS  release note: none (nobody would notice this change)");
        else
        {
            o.WriteLine("PASS  release note, as the release will carry it:");
            foreach (var l in n.Text.Split('\n')) o.WriteLine($"      {l}");
        }
        return 0;
    }
}
