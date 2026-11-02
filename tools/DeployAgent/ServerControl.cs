#nullable enable
using System.Diagnostics;
using System.Net.Sockets;
using System.Text.Json;

namespace Thornswood.DeployAgent;

/// <summary>Stopping and starting a game server, the way Swap.ps1's swap
/// block does: the process that holds the server's own UDP port and nothing
/// else, the server's scheduled task, and both ports asked from the box
/// itself. On the box it is WindowsServerControl; a test stands one in.</summary>
public interface IServerControl
{
    /// <summary>The pids holding UDP port. Throws ControlException when the
    /// ports cannot be listed: a list that cannot be had is not a free port.</summary>
    List<int> UdpHolders(int port);
    /// <summary>Ends the pids and waits up to within for each to exit, with
    /// the task asked to stop first, so its files are closed before anything
    /// is moved. Returns a line for each that has not exited.</summary>
    List<string> Stop(string task, IReadOnlyList<int> pids, TimeSpan within);
    /// <summary>Starts the server's scheduled task. Throws ControlException when it cannot.</summary>
    void Start(string task);
    /// <summary>Whether something accepts a connection on TCP port, from the box.</summary>
    bool TcpAnswers(int port);
}

public sealed class ControlException(string message) : Exception(message);

/// <summary>The box's own: PowerShell 7 for the port list and the
/// task, as Swap.ps1 runs them (Get-NetUDPEndpoint, Stop-ScheduledTask,
/// Start-ScheduledTask), and .NET for the processes and the TCP port.</summary>
public sealed class WindowsServerControl : IServerControl
{
    /// <summary>The box's PowerShell 7, where its MSI puts it (Bootstrap-VPS.ps1)
    /// and every box script runs (#5356).</summary>
    internal static readonly string Pwsh = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.ProgramFiles), "PowerShell", "7", "pwsh.exe");

    internal static string PowerShell(string command, Dictionary<string, string> env)
    {
        var ps = WindowsServerControl.Pwsh;
        var psi = new ProcessStartInfo(ps, ["-NoProfile", "-NonInteractive", "-Command", command])
        { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var (k, v) in env) psi.Environment[k] = v;
        using var p = Process.Start(psi) ?? throw new ControlException("PowerShell 7 did not start");
        var outText = p.StandardOutput.ReadToEnd();
        var err = p.StandardError.ReadToEnd().Trim();
        p.WaitForExit();
        if (p.ExitCode != 0) throw new ControlException(err == "" ? $"PowerShell 7 ended with {p.ExitCode}" : err);
        return outText.Trim();
    }

    public List<int> UdpHolders(int port)
    {
        // Listed whole and filtered, as Swap.ps1's Held does (#2711): with
        // -LocalPort, nothing on the port is an error.
        var said = PowerShell("$ErrorActionPreference = 'Stop'; @(Get-NetUDPEndpoint | Where-Object { $_.LocalPort -eq [int]$env:TW_PORT } | ForEach-Object { [int]$_.OwningProcess }) -join ','",
            new() { ["TW_PORT"] = port.ToString() });
        return said.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(int.Parse).Distinct().ToList();
    }

    public List<string> Stop(string task, IReadOnlyList<int> pids, TimeSpan within)
    {
        var lines = new List<string>();
        // Opened before the task is asked to stop, so the wait is on the very
        // process that held the port (StopAndMove.ps1, #2928).
        var held = new List<Process>();
        foreach (var id in pids.Where(i => i > 0 && i != System.Environment.ProcessId).Distinct())
        {
            try { held.Add(Process.GetProcessById(id)); }
            catch (ArgumentException) { }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { lines.Add($"COULD NOT OPEN pid {id} to wait for it to exit: {e.Message}"); }
        }
        try { PowerShell("Stop-ScheduledTask -TaskName $env:TW_TASK -ErrorAction SilentlyContinue", new() { ["TW_TASK"] = task }); }
        catch (ControlException e) { lines.Add($"the task {task} could not be asked to stop ({e.Message}); its process is ended by pid"); }
        var why = new Dictionary<int, string>();
        foreach (var p in held)
        {
            try { if (!p.HasExited) p.Kill(true); }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { why[p.Id] = e.Message; }
        }
        var until = DateTime.UtcNow + within;
        foreach (var p in held)
        {
            var left = (int)Math.Max(0, (until - DateTime.UtcNow).TotalMilliseconds);
            if (p.WaitForExit(left)) continue;
            lines.Add($"pid {p.Id} was ended and had not exited after {(int)within.TotalSeconds} seconds" + (why.TryGetValue(p.Id, out var w) ? "; ending it said: " + w : ""));
        }
        foreach (var p in held) p.Dispose();
        return lines;
    }

    public void Start(string task) =>
        PowerShell("$ErrorActionPreference = 'Stop'; Start-ScheduledTask -TaskName $env:TW_TASK", new() { ["TW_TASK"] = task });

    public bool TcpAnswers(int port)
    {
        using var c = new TcpClient();
        try { return c.ConnectAsync("127.0.0.1", port).Wait(500) && c.Connected; }
        catch (AggregateException) { return false; }
        catch (SocketException) { return false; }
    }
}

/// <summary>A hold: a server stopped on purpose says so, and the watchdog
/// leaves it stopped until the hold ends (#5155). The file
/// scripts/vps/ServerHold.ps1 writes, in the same place and shape: one per
/// server in &lt;root&gt;\holds, named by the task with everything but letters
/// and digits made a dash, holding target, by, why, set and until (unix
/// seconds). The watchdog never waits past 2 hours from when it was written.</summary>
public static class Hold
{
    public static string FileFor(string root, string target)
    {
        var name = System.Text.RegularExpressions.Regex.Replace(target, "[^A-Za-z0-9]+", "-").Trim('-');
        return Path.Combine(root, "holds", name + ".json");
    }

    /// <summary>Writes the hold and says so. With no watchdog folder there is
    /// no watchdog to hold back, and it says that instead.</summary>
    public static void Set(string root, string target, string why, string by, int minutes, Action<string> log)
    {
        if (root == "" || !Directory.Exists(root)) { log($"no hold for {target}: there is no {(root == "" ? "watchdog folder named" : root)}, so no watchdog runs here to hold back"); return; }
        minutes = Math.Clamp(minutes, 1, 120);
        var now = DateTimeOffset.Now;
        var until = now.AddMinutes(minutes);
        var file = FileFor(root, target);
        try
        {
            Files.WriteWhole(file, JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object>
            {
                ["target"] = target, ["by"] = by, ["why"] = why,
                ["set"] = now.ToUnixTimeSeconds(), ["until"] = until.ToUnixTimeSeconds(),
            }));
            log($"held {target} until {until:HH:mm} box time ({minutes} min): {why}");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log($"NO HOLD for {target}: {file} could not be written ({e.Message}), so the watchdog may start it within five minutes");
        }
    }

    public static void Clear(string root, string target, Action<string> log)
    {
        if (root == "") return;
        var file = FileFor(root, target);
        try { if (File.Exists(file)) { File.Delete(file); log($"the hold on {target} is taken away"); } }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log($"THE HOLD ON {target} COULD NOT BE TAKEN AWAY ({e.Message}); the watchdog leaves it until the hold runs out"); }
    }
}
