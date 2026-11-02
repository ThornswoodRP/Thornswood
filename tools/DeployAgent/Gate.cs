#nullable enable
using System.IO.Pipes;
using System.Text;
using System.Text.RegularExpressions;

namespace Thornswood.DeployAgent;

/// <summary>What one gate verb printed, and how it ended. Taken is false
/// when the broker never took the line (it was busy past the wait, or its
/// pipe refused this account), so the verb never started; a step after a
/// deploy (#5186) then runs with the next Deployment instead.</summary>
public sealed record GateRun(int Code, List<string> Lines, bool Taken = true);

/// <summary>Runs a verb of the deploy gate (#2841) on this box.</summary>
public interface IGate
{
    Task<GateRun> Run(string line, TimeSpan wait, Action<string> log, CancellationToken ct);
}

/// <summary>The gate broker's pipe, \\.\pipe\thornswood-gate, which admits
/// SYSTEM, the account the agent's service runs as (GateBroker.ps1). The
/// request is one line, LINE and the verb line in base64, the way Gate.ps1
/// sends it; the answer is the verb's lines, then @END and its exit code.
/// The broker holds the line to main's verbs.json and runs main's script,
/// so the agent can ask for nothing a person at Box-Run could not.
/// The broker runs one verb at a time and takes the next caller when it is
/// done, so a busy gate is waited for, up to wait, by the connect itself:
/// that is the order of the two runs, not a retry.</summary>
public sealed class GatePipe(string pipeName = "thornswood-gate") : IGate
{
    static readonly Regex End = new(@"^@END (-?[0-9]+)$");

    public async Task<GateRun> Run(string line, TimeSpan wait, Action<string> log, CancellationToken ct)
    {
        var lines = new List<string>();
        using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        try { await pipe.ConnectAsync(wait, ct); }
        catch (TimeoutException) { return new GateRun(65, [$"the gate did not take the request within {wait.TotalMinutes:0} minutes (it was running another verb all that time, or the task Thornswood Gate is not running)"], Taken: false); }
        catch (UnauthorizedAccessException e) { return new GateRun(65, ["the gate's pipe refused this account (" + e.Message + "); the broker admits SYSTEM and thornswood-deploy only"], Taken: false); }
        var enc = new UTF8Encoding(false);
        var gone = "";
        try
        {
            using var w = new StreamWriter(pipe, enc, 4096, true) { NewLine = "\n", AutoFlush = true };
            using var r = new StreamReader(pipe, enc, false, 4096, true);
            await w.WriteLineAsync("LINE " + Convert.ToBase64String(enc.GetBytes(line)));
            string? l;
            while ((l = await r.ReadLineAsync(ct)) != null)
            {
                var m = End.Match(l);
                if (m.Success) return new GateRun(int.Parse(m.Groups[1].Value), lines);
                // A verb's files come back as @FILE chunks; the agent reads its lines only.
                if (l.StartsWith("@FILE", StringComparison.Ordinal)) continue;
                var said = l.StartsWith("| ", StringComparison.Ordinal) ? l[2..] : l;
                lines.Add(said);
                log("  gate: " + said);
            }
        }
        // Windows says a pipe whose other end closed is broken, where Linux
        // reads its end: either way the broker is gone.
        catch (IOException e) { gone = " (" + e.Message + ")"; }
        lines.Add("the gate broker went away before it said how the verb ended" + gone + "; C:\\Thornswood-Gate\\log\\gate.log on the box says what it ran");
        return new GateRun(65, lines);
    }
}
