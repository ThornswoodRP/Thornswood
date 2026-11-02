#nullable enable
using System.Diagnostics;
using System.ServiceProcess;
using System.Text.Json;

namespace Thornswood.DeployAgent;

/// <summary>The box's own ways of stopping, starting and checking the site and
/// the Discord bot, the ones their deploy scripts' hooks use
/// (Deploy-Docs.ps1's site hooks, Install-Bot.ps1's bot hooks and
/// scripts/vps/Bot-Service.ps1): PowerShell 7 for the task, the
/// process list and the listening port, .NET for the service and the
/// processes.</summary>
public sealed class WindowsAppControl : IAppControl
{
    static string Ps(string command, Dictionary<string, string> env) => WindowsServerControl.PowerShell(command, env);

    public string NotInstalled(EnvConfig e)
    {
        if (!OperatingSystem.IsWindows()) return "the apps are looked after on Windows only";
        if (e.Kind == AppKinds.Discord)
        {
            try { using var sc = new ServiceController(e.Service); _ = sc.Status; }
            catch (InvalidOperationException) { return $"the service {e.Service} is not installed here; Install-Bot.ps1 sets the bot up once, and the agent swaps its code after that"; }
            if (!Directory.Exists(Path.Combine(e.Root, "data"))) return $"{Path.Combine(e.Root, "data")} is not there, where the bot writes its log; a full Install-Bot.ps1 run makes it with its rights";
            return "";
        }
        try
        {
            var said = Ps("if (Get-ScheduledTask -TaskName $env:TW_TASK -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }", new() { ["TW_TASK"] = e.Task });
            if (said != "yes") return $"the task {e.Task} is not on this box; " + (e.Kind == AppKinds.Voice ? "Install-Voice.ps1 sets voice up once" : "Deploy-Docs.ps1 sets the site up once") + ", and the agent swaps its files after that";
        }
        catch (ControlException x) { return $"the task {e.Task} could not be looked up: {x.Message}"; }
        return "";
    }

    /// <summary>The site: every node whose command line names its folder, and
    /// whatever listens on its port (an older install ran it as a bare
    /// server.js), opened before the task is asked to stop, then ended and
    /// waited for (Deploy-Docs.ps1's StopIt). The bot: the service's own
    /// process and the python it started, opened before the service is
    /// stopped, then any copy of the bot no service started
    /// (Stop-ThornswoodBotService, Stop-ThornswoodBotStrays).</summary>
    public StopResult Stop(EnvConfig e, TimeSpan within)
    {
        var lines = new List<string>();
        var left = new List<string>();
        if (e.Kind == AppKinds.Discord)
        {
            var ids = Pids("$w = Get-CimInstance Win32_Service -Filter (\"Name = '\" + $env:TW_SVC + \"'\"); " +
                           "if ($w -and $w.ProcessId) { [int]$w.ProcessId; @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + [int]$w.ProcessId) | ForEach-Object { [int]$_.ProcessId }) }",
                           new() { ["TW_SVC"] = e.Service }, lines);
            var held = Open(ids, left);
            try
            {
                using var sc = new ServiceController(e.Service);
                if (sc.Status != ServiceControllerStatus.Stopped)
                {
                    sc.Stop();
                    sc.WaitForStatus(ServiceControllerStatus.Stopped, within);
                }
                lines.Add($"stopped the service {e.Service}");
            }
            catch (Exception x) when (x is InvalidOperationException or System.ServiceProcess.TimeoutException or System.ComponentModel.Win32Exception)
            {
                lines.Add($"COULD NOT STOP the service {e.Service}: {x.Message}");
            }
            EndAndWait(held, within, left);
            var strays = Pids("@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(python|pythonw|powershell|pwsh|cmd)' -and $_.CommandLine -and " +
                              "$_.CommandLine.IndexOf($env:TW_MARK, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [int]$_.ProcessId })",
                              new() { ["TW_MARK"] = e.Root.TrimEnd('\\') + "\\" }, lines);
            var sh = Open(strays, left);
            foreach (var p in sh) lines.Add($"stopped a copy of the bot no service started, pid {p.Id} ({p.ProcessName})");
            EndAndWait(sh, within, left);
            return new StopResult(lines, left);
        }
        var port = new Uri(e.Health).Port;
        var pids = Pids("@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($env:TW_MARK, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [int]$_.ProcessId }); " +
                        "@(Get-NetTCPConnection -LocalPort ([int]$env:TW_PORT) -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess })",
                        new() { ["TW_MARK"] = e.Root.TrimEnd('\\') + "\\", ["TW_PORT"] = port.ToString() }, lines);
        var open = Open(pids, left);
        try { Ps("Stop-ScheduledTask -TaskName $env:TW_TASK -ErrorAction SilentlyContinue", new() { ["TW_TASK"] = e.Task }); }
        catch (ControlException x) { lines.Add($"the task {e.Task} could not be asked to stop ({x.Message}); its processes are ended by pid"); }
        foreach (var p in open) lines.Add($"stopped pid {p.Id}");
        EndAndWait(open, within, left);
        return new StopResult(lines, left);
    }

    public void Start(EnvConfig e)
    {
        if (e.Kind == AppKinds.Discord)
        {
            try
            {
                using var sc = new ServiceController(e.Service);
                sc.Start();
                sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
            }
            catch (Exception x) when (x is InvalidOperationException or System.ServiceProcess.TimeoutException or System.ComponentModel.Win32Exception)
            {
                throw new ControlException($"THE SERVICE DID NOT START: {x.Message}");
            }
            return;
        }
        Ps("$ErrorActionPreference = 'Stop'; Start-ScheduledTask -TaskName $env:TW_TASK", new() { ["TW_TASK"] = e.Task });
    }

    public bool Running(EnvConfig e)
    {
        if (e.Service == "") return false;
        try { using var sc = new ServiceController(e.Service); return sc.Status == ServiceControllerStatus.Running; }
        catch (InvalidOperationException) { return false; }
    }

    /// <summary>The python the bot's service runs (service\host.json, which
    /// Install-Bot.ps1 writes), or the one on the machine's path.</summary>
    static string Python(EnvConfig e)
    {
        var host = Path.Combine(e.Root, "service", "host.json");
        try
        {
            using var d = JsonDocument.Parse(File.ReadAllText(host));
            if (d.RootElement.TryGetProperty("python", out var p) && p.GetString() is { Length: > 0 } s && File.Exists(s)) return s;
        }
        catch (Exception x) when (x is IOException or JsonException or UnauthorizedAccessException) { }
        return "python";
    }

    public string Parse(EnvConfig e, string path)
    {
        var js = path.EndsWith(".js", StringComparison.OrdinalIgnoreCase);
        var (code, said) = Run(js ? "node" : Python(e),
            js ? ["--check", path] : ["-c", "import ast,sys; ast.parse(open(sys.argv[1],'rb').read(), sys.argv[1])", path], null, TimeSpan.FromSeconds(60));
        if (code == 0) return "";
        var first = said.Split('\n').Select(l => l.Trim()).Where(l => l != "").Take(6);
        return code == -1 ? said : string.Join(" | ", first);
    }

    /// <summary>Install-Bot.ps1's full run, for the libraries alone: pip into
    /// the stage's py-libs at the versions and hashes requirements.txt names,
    /// wheels only; every file then under the bot folder's own rules (pip's
    /// temporary folder keeps them from the bot's account, #1543), refused
    /// when the account still cannot read one; then trust.py has to make the
    /// bot's roots from the certifi that went in (#3111).</summary>
    public string Libraries(EnvConfig e, string requirements, string dir, string trustPy)
    {
        var py = Python(e);
        var (code, said) = Run(py, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--require-hashes", "--only-binary", ":all:", "--upgrade",
            "--target", dir, "-r", requirements], null, TimeSpan.FromMinutes(10));
        if (code != 0) return $"pip ended with {code}: " + Last(said);
        try
        {
            var shut = Ps("$ErrorActionPreference = 'Stop'; & icacls $env:TW_DIR /reset /T /Q 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { 'icacls ended with ' + $LASTEXITCODE; return }; " +
                          "$rx = [Security.AccessControl.FileSystemRights]::ReadAndExecute; " +
                          "$shut = @(Get-ChildItem -LiteralPath $env:TW_DIR -File -Recurse | Where-Object { -not @((Get-Acl -LiteralPath $_.FullName).Access | Where-Object { " +
                          "$_.IdentityReference.Value -eq ('NT SERVICE\\' + $env:TW_SVC) -and $_.AccessControlType -eq 'Allow' -and ($_.FileSystemRights -band $rx) -eq $rx }) }); " +
                          "if ($shut.Count) { 'NT SERVICE\\' + $env:TW_SVC + ' cannot read ' + $shut.Count + ' file(s) of them, first ' + $shut[0].Name }",
                          new() { ["TW_DIR"] = dir, ["TW_SVC"] = e.Service });
            if (shut != "") return shut;
        }
        catch (ControlException x) { return "the libraries' rights could not be set: " + x.Message; }
        var (tc, ts) = Run(py, [trustPy], new() { ["PYTHONPATH"] = dir }, TimeSpan.FromSeconds(60));
        if (tc != 0) return "trust.py could not make the bot's roots from them: " + Last(ts);
        return "";
    }

    static string Last(string said) => string.Join(" | ", said.Split('\n').Select(l => l.Trim()).Where(l => l != "").TakeLast(4));

    /// <summary>Runs a program, hands back its exit code and all it printed;
    /// -1 and why when it could not be started or ran past within.</summary>
    static (int, string) Run(string exe, string[] args, Dictionary<string, string>? env, TimeSpan within)
    {
        var psi = new ProcessStartInfo(exe, args) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var (k, v) in env ?? []) psi.Environment[k] = v;
        Process? p;
        try { p = Process.Start(psi); }
        catch (System.ComponentModel.Win32Exception x) { return (-1, $"{exe} is not on this machine ({x.Message})"); }
        if (p == null) return (-1, $"{exe} did not start");
        using (p)
        {
            var o = p.StandardOutput.ReadToEndAsync();
            var er = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(within))
            {
                try { p.Kill(true); } catch (InvalidOperationException) { }
                return (-1, $"{exe} ran past {(int)within.TotalSeconds} seconds and was ended");
            }
            return (p.ExitCode, o.Result + er.Result);
        }
    }

    static List<int> Pids(string command, Dictionary<string, string> env, List<string> lines)
    {
        try
        {
            return Ps(command, env).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(int.Parse).Where(i => i > 0 && i != System.Environment.ProcessId).Distinct().ToList();
        }
        catch (Exception x) when (x is ControlException or FormatException)
        {
            lines.Add("COULD NOT LIST what runs it: " + x.Message);
            return [];
        }
    }

    /// <summary>Opened before anything is asked to stop, so the wait is on the
    /// very process (StopAndMove.ps1, #2928). One that cannot be opened is
    /// left, and nothing it may hold is moved.</summary>
    static List<Process> Open(List<int> ids, List<string> left)
    {
        var held = new List<Process>();
        foreach (var id in ids)
        {
            try { held.Add(Process.GetProcessById(id)); }
            catch (ArgumentException) { }
            catch (Exception x) when (x is InvalidOperationException or System.ComponentModel.Win32Exception) { left.Add($"COULD NOT OPEN pid {id} to wait for it to exit: {x.Message}"); }
        }
        return held;
    }

    static void EndAndWait(List<Process> held, TimeSpan within, List<string> left)
    {
        foreach (var p in held)
        {
            try { if (!p.HasExited) p.Kill(true); }
            catch (Exception x) when (x is InvalidOperationException or System.ComponentModel.Win32Exception) { }
        }
        var until = DateTime.UtcNow + within;
        foreach (var p in held)
        {
            var ms = (int)Math.Max(0, (until - DateTime.UtcNow).TotalMilliseconds);
            if (!p.WaitForExit(ms)) left.Add($"pid {p.Id} was ended and had not exited after {(int)within.TotalSeconds} seconds");
            p.Dispose();
        }
    }
}
