using System.Text.RegularExpressions;

namespace Thornswood.ReleaseNotes;

/// <summary>
/// What release notes may say, and the release note a pull request carries
/// (#5179). The same rules as scripts/release/Note-Rules.ps1, whose header
/// says why each one exists; tests/fixtures/note-rules-cases.json holds both
/// to the same answer for every case, until the scripts that still
/// dot-source the PowerShell copy (Ship.ps1, Rollback-Feed.ps1,
/// Deploy-DevGamemode.ps1, Collect-ReleaseNotes.ps1, EnginePin.ps1) move here
/// or retire.
///
/// In the title, the body and every detail line it refuses: the word player
/// or players; an em dash; an issue or pull request number, "PR", "pull
/// request"; a code file name; our own shop words (demoting, worktree,
/// cherry-pick, squash, CI); an environment variable; a code identifier
/// (camelCase, or three or more joined capitalised words) unless it is one of
/// <see cref="AllowedNames"/>; a version number in the title, and a four-part
/// number anywhere; and the same line twice. Each problem is one line saying
/// what and where.
///
/// The PowerShell rules use -match, which ignores case, except where they say
/// -cmatch; every pattern here keeps that, so the two answer alike.
/// </summary>
public static class NoteRules
{
    public static readonly string[] AllowedNames =
    [
        "SkyUI", "SkyMP", "SkyrimPlatform", "GitHub", "YouTube", "TikTok", "VirusTotal",
        "WebView", "NirnLab", "SunHelm", "RaceMenu", "MaxOnline", "PayPal", "JContainers",
    ];

    const RegexOptions I = RegexOptions.IgnoreCase;
    static readonly Regex LineBreak = new(@"\r?\n");
    static readonly Regex Space = new(@"\s+");
    static readonly Regex Bullet = new(@"^\s*-\s*\S", I);
    static readonly Regex BulletLead = new(@"^\s*-\s*", I);
    static readonly Regex Blank = new(@"^[\W_]*$", I);
    static readonly Regex Placeholder = new(@"^(test|testing|wip|update|updates|fix|fixes|changes|stuff|dev|build|misc)\W*$", I);
    static readonly Regex Version = new(@"\b\d+\.\d+\.\d+\b", I);
    static readonly Regex FourPart = new(@"\b\d{1,3}(\.\d{1,3}){3}\b", I);
    static readonly Regex Player = new(@"(?i)\bplayers?\b", I);
    static readonly Regex Hash = new(@"#\d+", I);
    static readonly Regex Pr = new(@"\bPR\b", I);
    static readonly Regex PullRequest = new(@"(?i)\bpull request", I);
    static readonly Regex CodeFile = new(@"(?i)\b[\w-]+\.(cs|ps1|psm1|js|ts|dll|json|exe|xaml|py|bat|cmd|pdb|txt|log)\b", I);
    static readonly Regex ShopWord = new(@"(?i)\b(demot(e|ed|ing)|worktrees?|cherry-?pick(ed)?|squash(ed)?)\b", I);
    static readonly Regex Ci = new(@"\bCI\b");
    static readonly Regex Variable = new(@"\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b", I);
    static readonly Regex Word = new(@"\b[A-Za-z][A-Za-z0-9]*\b");
    static readonly Regex Camel = new(@"^[a-z]+[A-Z][A-Za-z0-9]*$");
    static readonly Regex Hump = new(@"[A-Z][a-z]+");
    static readonly Regex Pascal = new(@"^[A-Z][a-z]+([A-Z][a-z0-9]+){2,}$");

    /// <summary>A note has a title of three words or more that is not a placeholder, and a "- " line of 12 characters or more.</summary>
    public static string[] ShapeProblems(string? notes)
    {
        var problems = new List<string>();
        var lines = LineBreak.Split(notes ?? "");
        var title = (lines.FirstOrDefault(l => l.Trim().Length > 0) ?? "").Trim();
        var bullets = lines.Count(l => Bullet.IsMatch(l) && BulletLead.Replace(l, "").Trim().Length >= 12);
        var placeholder = Blank.IsMatch(title) || Placeholder.IsMatch(title);
        if (placeholder || Space.Split(title).Count(w => w.Length > 0) < 3)
            problems.Add($"the title '{title}' is too short to say what changed.");
        if (bullets < 1)
            problems.Add("there is no detail line: at least one line starting with \"- \".");
        return [.. problems];
    }

    /// <summary>What a note's words break, one line each.</summary>
    public static string[] Problems(string? notes)
    {
        var problems = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var lines = LineBreak.Split(notes ?? "").Select(l => l.Trim()).Where(l => l.Length > 0);
        int n = 0;
        foreach (var raw in lines)
        {
            n++;
            var line = BulletLead.Replace(raw, "").Trim();
            var where = n == 1 ? "the title" : $"line {n}";
            var shortLine = line.Length > 60 ? line[..57] + "..." : line;

            if (!seen.Add(line.ToLowerInvariant())) { problems.Add($"{where} repeats an earlier line: '{shortLine}'"); continue; }

            if (n == 1 && Version.IsMatch(line)) problems.Add($"the title names a version; say what changed instead: '{shortLine}'");
            if (FourPart.IsMatch(line)) problems.Add($"{where} has a four-part number, which reads as a server address: '{shortLine}'");
            if (Player.IsMatch(line)) problems.Add($"{where} says player; the people in the world are customers, testers or people: '{shortLine}'");
            if (line.Contains('—')) problems.Add($"{where} has an em dash; use a comma or a full stop: '{shortLine}'");
            if (Hash.IsMatch(line) || Pr.IsMatch(line) || PullRequest.IsMatch(line)) problems.Add($"{where} names an issue or pull request; say what changed for the person instead: '{shortLine}'");
            if (CodeFile.IsMatch(line)) problems.Add($"{where} names a code file: '{shortLine}'");
            var shop = ShopWord.Match(line);
            if (!shop.Success) shop = Ci.Match(line);
            if (shop.Success) problems.Add($"{where} uses a word from how we work, not from the game ({shop.Value}): '{shortLine}'");
            var variable = Variable.Match(line);
            if (variable.Success) problems.Add($"{where} names a setting or variable ({variable.Value}): '{shortLine}'");
            foreach (Match m in Word.Matches(line))
            {
                var w = m.Value;
                if (AllowedNames.Contains(w, StringComparer.OrdinalIgnoreCase)) continue;
                var camel = Camel.IsMatch(w);
                var pascal = Pascal.IsMatch(w) && Hump.Matches(w).Count >= 3;
                if (camel || pascal) { problems.Add($"{where} names something in the code ({w}): '{shortLine}'"); break; }
            }
        }
        return [.. problems];
    }

    /// <summary>Both: what a release's whole note is held to.</summary>
    public static string[] AllProblems(string? notes) => [.. ShapeProblems(notes), .. Problems(notes)];
}

/// <summary>The "Release note:" line of a pull request body (#5179), outside any HTML comment.</summary>
public sealed record PrNote(bool Found, bool None, string Headline, string[] Details, string Text, int Count)
{
    static readonly Regex Comment = new(@"(?s)<!--.*?-->");
    static readonly Regex LineBreak = new(@"\r?\n");
    static readonly Regex Label = new(@"^\s*(\*\*)?Release note:(\*\*)?\s*(.*?)\s*$", RegexOptions.IgnoreCase);
    static readonly Regex NoneWord = new(@"^(?i)none\.?$", RegexOptions.IgnoreCase);
    static readonly Regex Detail = new(@"^\s*-\s+\S", RegexOptions.IgnoreCase);

    public static PrNote Read(string? body)
    {
        var lines = LineBreak.Split(Comment.Replace(body ?? "", ""));
        var at = Enumerable.Range(0, lines.Length).Where(i => Label.IsMatch(lines[i])).ToArray();
        if (at.Length == 0) return new(false, false, "", [], "", 0);
        var headline = Label.Match(lines[at[0]]).Groups[3].Value.Trim();
        if (NoneWord.IsMatch(headline)) return new(true, true, headline, [], "", at.Length);
        var details = lines.Skip(at[0] + 1).TakeWhile(l => Detail.IsMatch(l)).Select(l => l.Trim()).ToArray();
        return new(true, false, headline, details, string.Join("\n", new[] { headline }.Concat(details)), at.Length);
    }

    /// <summary>What is wrong with a body's release note, one line each; none when it is right.
    /// Dependabot's pull requests only move the versions of what we build with, so they say none by rule.</summary>
    public static string[] Problems(string? body, string? author = "")
    {
        if (string.Equals(author, "dependabot[bot]", StringComparison.OrdinalIgnoreCase)) return [];
        var n = Read(body);
        var problems = new List<string>();
        if (!n.Found)
        {
            problems.Add("there is no \"Release note:\" line. Add one under \"For the Thornswood team\": \"Release note: none\" when nobody would notice the change, otherwise a headline people read and a \"- \" line under it.");
            return [.. problems];
        }
        if (n.Count > 1) problems.Add($"there are {n.Count} Release note lines; keep one, so the release says one thing for this change.");
        if (n.None) return [.. problems];
        if (n.Headline.Length == 0) problems.Add("the Release note line is empty: write a headline, or \"none\".");
        problems.AddRange(NoteRules.ShapeProblems(n.Text));
        problems.AddRange(NoteRules.Problems(n.Text));
        return [.. problems];
    }

    /// <summary>The notes of the pull requests a release carries, in merge order, joined into the release's note:
    /// the first one's headline is the title, its details follow, and each later one gives its headline as a
    /// "- " line and then its own details. A line already there is not written twice; a body whose note is
    /// none, or that has none, is left out. "" when none of them has a note.</summary>
    public static string Join(IEnumerable<string?> bodies)
    {
        var lead = new Regex(@"^\s*-\s*", RegexOptions.IgnoreCase);
        var outLines = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        void Add(string line)
        {
            if (seen.Add(lead.Replace(line, "").Trim().ToLowerInvariant())) outLines.Add(line);
        }
        foreach (var body in bodies)
        {
            var n = Read(body);
            if (!n.Found || n.None || n.Headline.Length == 0) continue;
            Add(outLines.Count == 0 ? n.Headline : "- " + n.Headline);
            foreach (var d in n.Details) Add(d);
        }
        return string.Join("\n", outLines);
    }
}
