using System.Text.Json;
using Xunit;

namespace Thornswood.ReleaseNotes.Tests;

/// <summary>The C# rules give every case in tests/fixtures/note-rules-cases.json the
/// answer scripts/release/Note-Rules.ps1 gave it.</summary>
public class NoteRulesTests
{
    static readonly JsonElement Cases = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "note-rules-cases.json"))).RootElement;

    static string[] Strings(JsonElement e) => [.. e.EnumerateArray().Select(x => x.GetString() ?? "")];

    public static TheoryData<int> Notes() { var d = new TheoryData<int>(); for (int i = 0; i < Cases.GetProperty("notes").GetArrayLength(); i++) d.Add(i); return d; }
    public static TheoryData<int> Bodies() { var d = new TheoryData<int>(); for (int i = 0; i < Cases.GetProperty("bodies").GetArrayLength(); i++) d.Add(i); return d; }
    public static TheoryData<int> Joins() { var d = new TheoryData<int>(); for (int i = 0; i < Cases.GetProperty("joins").GetArrayLength(); i++) d.Add(i); return d; }

    [Fact]
    public void TheFixtureHoldsEnoughCases()
    {
        Assert.True(Cases.GetProperty("notes").GetArrayLength() >= 50);
        Assert.True(Cases.GetProperty("bodies").GetArrayLength() >= 10);
        Assert.True(Cases.GetProperty("joins").GetArrayLength() >= 3);
    }

    [Theory, MemberData(nameof(Notes))]
    public void ANoteGetsTheSameProblems(int i)
    {
        var c = Cases.GetProperty("notes")[i];
        var note = c.GetProperty("note").GetString();
        Assert.Equal(Strings(c.GetProperty("shape")), NoteRules.ShapeProblems(note));
        Assert.Equal(Strings(c.GetProperty("words")), NoteRules.Problems(note));
        Assert.Equal([.. Strings(c.GetProperty("shape")), .. Strings(c.GetProperty("words"))], NoteRules.AllProblems(note));
    }

    [Theory, MemberData(nameof(Bodies))]
    public void ABodyReadsTheSame(int i)
    {
        var c = Cases.GetProperty("bodies")[i];
        var body = c.GetProperty("body").GetString();
        var n = PrNote.Read(body);
        Assert.Equal(c.GetProperty("found").GetBoolean(), n.Found);
        Assert.Equal(c.GetProperty("none").GetBoolean(), n.None);
        Assert.Equal(c.GetProperty("headline").GetString(), n.Headline);
        Assert.Equal(Strings(c.GetProperty("details")), n.Details);
        Assert.Equal(c.GetProperty("text").GetString(), n.Text);
        Assert.Equal(c.GetProperty("count").GetInt32(), n.Count);
        Assert.Equal(Strings(c.GetProperty("problems")), PrNote.Problems(body, c.GetProperty("author").GetString()));
    }

    [Theory, MemberData(nameof(Joins))]
    public void BodiesJoinTheSame(int i)
    {
        var c = Cases.GetProperty("joins")[i];
        Assert.Equal(c.GetProperty("note").GetString(), PrNote.Join(Strings(c.GetProperty("bodies"))));
    }

    [Fact]
    public void TheCommandPassesARightNote()
    {
        var f = Path.GetTempFileName();
        try
        {
            File.WriteAllText(f, "Release note: The forge shows the price before you pay\n- The forge window lists each metal a piece takes.\n");
            var o = new StringWriter();
            Assert.Equal(0, Program.Run(["pr", "--body-file", f], o));
            Assert.Contains("PASS  release note, as the release will carry it:", o.ToString());
            Assert.Contains("      - The forge window lists each metal a piece takes.", o.ToString());
        }
        finally { File.Delete(f); }
    }

    [Fact]
    public void TheCommandStopsAWrongNoteAndSaysEachProblem()
    {
        var f = Path.GetTempFileName();
        try
        {
            File.WriteAllText(f, "Release note: Fix\n");
            var o = new StringWriter();
            Assert.Equal(1, Program.Run(["pr", "--body-file", f], o));
            var said = o.ToString();
            Assert.Contains("STOP  release note: the title 'Fix' is too short to say what changed.", said);
            Assert.Contains("STOP  release note: there is no detail line", said);
        }
        finally { File.Delete(f); }
    }

    [Fact]
    public void TheCommandPassesNoneAndDependabot()
    {
        var f = Path.GetTempFileName();
        try
        {
            File.WriteAllText(f, "Release note: none\n");
            var o = new StringWriter();
            Assert.Equal(0, Program.Run(["pr", "--body-file", f], o));
            Assert.Contains("PASS  release note: none (nobody would notice this change)", o.ToString());
            File.WriteAllText(f, "Bumps a package.\n");
            o = new StringWriter();
            Assert.Equal(0, Program.Run(["pr", "--body-file", f, "--author", "dependabot[bot]"], o));
            Assert.Contains("PASS  release note: none, by rule for a Dependabot pull request", o.ToString());
        }
        finally { File.Delete(f); }
    }

    [Fact]
    public void TheCommandSaysAUsageMistakeWithTwo()
    {
        Assert.Equal(2, Program.Run([], new StringWriter()));
        Assert.Equal(2, Program.Run(["pr"], new StringWriter()));
        Assert.Equal(2, Program.Run(["nope"], new StringWriter()));
        Assert.Equal(1, Program.Run(["pr", "--body-file", "/no/such/file"], new StringWriter()));
    }
}
