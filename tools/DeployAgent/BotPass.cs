#nullable enable
using System.Text;
// The bot pass a dev Deployment waits on (#5196). Before the agent puts a
// new gamemode on dev, it makes a throwaway copy of the dev server with that
// gamemode, in a folder of its own on ports of its own, and starts the
// scheduled task "Thornswood Bot Pass", which runs scripts/bot/Bot-Pass.js
// from the same signed Release in that copy. The task runs as LOCAL SERVICE
// with a SID of its own and rights in its own folder only, like the game
// servers (scripts/deploy/ServiceAccount.ps1), at below normal priority, so
// the gamemode and the engine run there with no more reach than dev's own
// server has, and the agent itself never runs node or loads the engine. The
// agent only reads the result the task wrote. A FAIL there, or a pass that
// does not end in time, fails the Deployment and dev keeps what it runs.
//
// What goes into the copy, and what never does:
//  - the engine (dist_back, scam_native.node, package.json, the DLLs beside
//    it) from dev's folder, and gamemode.js and its stamp from the Release,
//    with the gamemode's tables folder (#5191): the Release's, else dev's;
//  - dev's data folder, which the server serves to anybody on its resources
//    port, so nothing in it is private; but not the plugins and archives,
//    which are read where they are kept for the bot pass (plugins\, copied
//    from dev's only when they change) by their full paths;
//  - dev's settings with the keys that reach outside taken out
//    (discordAuth, metricsAuth, masterKey, additionalServerSettings), no
//    master server, offline login, no join pass hold, a password of its own,
//    and ports from 7900 that nothing else holds;
//  - never dev's world, its private folder (door.json and the join pass key),
//    its logs or its deploy records. The world starts empty.
// docs/DEPLOY-AGENT.md has the whole design.
using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Thornswood.DeployAgent;

/// <summary>What Task Scheduler says about a task.</summary>
public sealed record TaskInfo(string State, DateTime LastRun, int LastResult);

/// <summary>Starts and reads a scheduled task. On the box it is WindowsTasks;
/// a test stands one in.</summary>
public interface ITasks
{
    void Start(string name);
    TaskInfo Info(string name);
    void End(string name);
}

/// <summary>Task Scheduler through PowerShell 7's ScheduledTasks module,
/// the way the installers register the tasks.</summary>
public sealed class WindowsTasks : ITasks
{
    static string Ps(string command, string task)
    {
        var ps = WindowsServerControl.Pwsh;
        var psi = new ProcessStartInfo(ps, ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; " + command])
        { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.Environment["TW_TASK"] = task;
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("PowerShell 7 did not start");
        var outText = p.StandardOutput.ReadToEnd().Trim();
        var err = p.StandardError.ReadToEnd().Trim();
        p.WaitForExit();
        if (p.ExitCode != 0) throw new InvalidOperationException($"the task {task}: {(err != "" ? err : outText)}");
        return outText;
    }

    public void Start(string name) => Ps("Start-ScheduledTask -TaskName $env:TW_TASK", name);

    public void End(string name) => Ps("Stop-ScheduledTask -TaskName $env:TW_TASK", name);

    public TaskInfo Info(string name)
    {
        var said = Ps("$t = Get-ScheduledTask -TaskName $env:TW_TASK; $i = $t | Get-ScheduledTaskInfo; " +
                      "'{0}|{1}|{2}' -f $t.State, $i.LastRunTime.ToUniversalTime().ToString('o'), $i.LastTaskResult", name);
        var p = said.Split('|');
        if (p.Length != 3) throw new InvalidOperationException($"the task {name}: Task Scheduler said \"{said}\"");
        var last = DateTime.TryParse(p[1], null, System.Globalization.DateTimeStyles.RoundtripKind, out var t) ? t.ToUniversalTime() : DateTime.MinValue;
        return new TaskInfo(p[0], last, int.TryParse(p[2], out var r) ? r : -1);
    }
}

/// <summary>One line of a pass, as Bot-Pass.js wrote it.</summary>
public sealed class PassLine
{
    public string Step { get; set; } = "";
    public bool Ok { get; set; }
    public string Detail { get; set; } = "";
}

public sealed class PassResult
{
    public int Schema { get; set; }
    public bool Ok { get; set; }
    public List<PassLine> Lines { get; set; } = new();
    public string Blob { get; set; } = "";
    public List<string> Tail { get; set; } = new();
}

public sealed class BotPass(EnvConfig env, ITasks tasks)
{
    /// <summary>The file of the bot part the task runs. The rest of the part
    /// is whatever that file needs beside it, and the copy takes the part
    /// whole, so the bot can carry more (the voice service it joins, #5196)
    /// without this agent having to know each file by name.</summary>
    public const string Runs = "Bot-Pass.js";

    /// <summary>Settings that reach outside the box or hold a secret, which a
    /// throwaway copy has no use for.</summary>
    public static readonly string[] Dropped = ["discordAuth", "metricsAuth", "masterKey", "additionalServerSettings", "gamemodePath"];

    static readonly string[] FiveMasters = ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"];
    static readonly string[] GameFileKinds = [".esm", ".esp", ".esl", ".bsa"];
    /// <summary>What the agent and the server write in a data folder, which
    /// the copy makes for itself or has no use for.</summary>
    static bool AgentOrServerMade(string name) =>
        name.Equals("manifest.json", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("thornswood-deploy.json", StringComparison.OrdinalIgnoreCase) ||
        (name.StartsWith("deploy-", StringComparison.OrdinalIgnoreCase) && name.EndsWith(".log", StringComparison.OrdinalIgnoreCase));

    public TimeSpan Tick { get; set; } = TimeSpan.FromSeconds(2);
    /// <summary>The ports in use on this machine: UDP, then TCP. A test stands one in.</summary>
    public Func<(HashSet<int> udp, HashSet<int> tcp)> InUse { get; set; } = () =>
    {
        var ip = IPGlobalProperties.GetIPGlobalProperties();
        return (ip.GetActiveUdpListeners().Select(e => e.Port).ToHashSet(), ip.GetActiveTcpListeners().Select(e => e.Port).ToHashSet());
    };

    public string Root => env.BotPassRoot;
    public string RunDir => Path.Combine(Root, "run");
    public string ServerDir => Path.Combine(RunDir, "server");
    public string BotDir => Path.Combine(RunDir, "bot");
    public string ResultPath => Path.Combine(RunDir, "result.json");
    public string PluginDir => Path.Combine(Root, "plugins");

    public string PassLogPath => Path.Combine(RunDir, "bot-pass.log");
    /// <summary>Where each pass's logs are kept once the next pass needs the
    /// run folder: passes\&lt;when it last wrote&gt;-&lt;its Deployment&gt;.</summary>
    public string KeptDir => Path.Combine(Root, "passes");
    /// <summary>How many kept passes stay, the newest; and how much of each
    /// log, its end, so a server that wrote without end cannot fill the disk.</summary>
    public const int KeepPasses = 30;
    public const long KeepBytes = 8L << 20;
    /// <summary>The file in the run folder naming the pass's Deployment.</summary>
    public const string PassName = "pass.txt";
    static readonly string[] PassFiles = ["bot-pass.log", "server/bot-pass-server.log", "result.json", PassName];

    static string PlainName(string name) => new(name.Where(c => char.IsAsciiLetterOrDigit(c) || c == '-').Take(64).ToArray());

    /// <summary>Copies the last pass's logs out of the run folder before it is
    /// emptied, so no pass's measurement is lost to the next one: Deployment
    /// 7480554210's copy held the only record of where its pass hung, and the
    /// next pass would have emptied it. A pass made before pass.txt is kept
    /// as "unnamed". Returns the folder, or null when there was nothing.</summary>
    public string? KeepLast(Action<string> log)
    {
        var present = PassFiles.Select(r => (r, at: Path.Combine(RunDir, r.Replace('/', Path.DirectorySeparatorChar)))).Where(x => File.Exists(x.at)).ToList();
        if (present.Count == 0 || present.All(x => x.r == PassName)) return null;
        var named = Path.Combine(RunDir, PassName);
        var name = File.Exists(named) ? PlainName(File.ReadAllText(named).Trim()) : "";
        var when = present.Max(x => File.GetLastWriteTimeUtc(x.at));
        var dir = Path.Combine(KeptDir, $"{when:yyyyMMdd-HHmmss}-{(name == "" ? "unnamed" : name)}");
        foreach (var (r, at) in present)
        {
            var to = Path.Combine(dir, Path.GetFileName(r));
            Directory.CreateDirectory(dir);
            using var src = Files.OpenShared(at);
            using var dst = new FileStream(to, FileMode.Create, FileAccess.Write, FileShare.None);
            if (src.Length > KeepBytes)
            {
                dst.Write(Encoding.UTF8.GetBytes($"[the first {src.Length - KeepBytes} bytes of {src.Length} were left out; this is its end]\n"));
                src.Seek(src.Length - KeepBytes, SeekOrigin.Begin);
            }
            src.CopyTo(dst);
            dst.Flush(true);
        }
        foreach (var old in Directory.GetDirectories(KeptDir).OrderByDescending(Path.GetFileName, StringComparer.Ordinal).Skip(KeepPasses))
            Directory.Delete(old, true);
        log($"the last pass's logs are kept in {dir}");
        return dir;
    }
    public string ServerLogPath => Path.Combine(ServerDir, "bot-pass-server.log");

    /// <summary>For a pass that wrote no result: where Bot-Pass.js had got to
    /// (bot-pass.log, which it writes as each step starts and ends) and what
    /// the copy's server said last, so the Deployment's log says where it
    /// stopped and nobody has to fetch either off the box.</summary>
    void SayWhereItGot(Action<string> log)
    {
        SayTail(log, PassLogPath, 20, "the pass's own lines, last 20 (bot-pass.log)",
            "Bot-Pass.js wrote nothing to bot-pass.log, so node never ran it (or it stopped before its first line)");
        SayTail(log, ServerLogPath, 40, "the copy's server said, last 40 lines (bot-pass-server.log)",
            "the copy's server wrote nothing to bot-pass-server.log, so it was never started");
    }

    static void SayTail(Action<string> log, string at, int n, string what, string none)
    {
        List<string> tail;
        try
        {
            tail = [];
            if (File.Exists(at))
            {
                // Its last 64 KiB: the log of a pass that ran on can be long.
                using var f = Files.OpenShared(at);
                f.Seek(Math.Max(0, f.Length - (64 << 10)), SeekOrigin.Begin);
                using var ms = new MemoryStream();
                f.CopyTo(ms);
                tail = Encoding.UTF8.GetString(ms.ToArray()).Replace("\r\n", "\n").Split('\n').Where(l => l != "").TakeLast(n).ToList();
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log($"{Path.GetFileName(at)} could not be read: {e.Message}"); return; }
        if (tail.Count == 0) { log(none); return; }
        log($"--- {what} ---");
        foreach (var l in Server.Redact(tail)) log("  " + l);
    }

    /// <summary>Makes the copy, runs the task, reads what it wrote. files are
    /// the Release's gamemode and bot parts, each held to the signed manifest;
    /// bot names the files of the bot part, which go into the copy's bot
    /// folder, every one of them.
    /// serverZip, when given, is the server build the Deployment swaps dev
    /// onto (#5219), held to the signed manifest too: the copy runs that
    /// engine and not dev's, so the pass checks what dev will run.</summary>
    public async Task<Outcome> Run(IReadOnlyDictionary<string, string> files, IReadOnlyCollection<string> bot, Action<string> log, CancellationToken ct, string? serverZip = null, string name = "")
    {
        if (!bot.Contains(Runs)) return new Outcome("failure", $"not applied: the Release's bot part has no {Runs}, and dev's deploys wait on the bot pass");
        foreach (var n in bot.Concat(Server.ReloadFiles))
            if (!files.ContainsKey(n)) return new Outcome("failure", $"not applied: the Release has no {n}, and dev's deploys wait on the bot pass");
        string why;
        using (var turn = TakeTurn(log, out why))
        {
            if (turn == null) return new Outcome("failure", "not applied: " + why);
            try { why = Prepare(files, bot, log, serverZip, name); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or InvalidDataException) { why = e.Message; }
        }
        if (why != "") return new Outcome("failure", "not applied: the bot pass copy could not be made: " + why);

        // The task takes one instance at a time and ignores a start while one
        // runs (MultipleInstances IgnoreNew), so a pass still running from
        // before would be waited on as if it were this one, to the limit.
        TaskInfo before;
        try
        {
            before = tasks.Info(env.BotPassTask);
            if (before.State is "Running" or "Queued")
            {
                log($"the bot pass task is already {before.State}, a run from {before.LastRun:yyyy-MM-dd HH:mm:ss}Z, and takes one run at a time (IgnoreNew), so a start now would be ignored and that run waited on as this one; nothing was started");
                return new Outcome("failure", $"not applied: the bot pass task is still {before.State} from {before.LastRun:HH:mm}Z, so a start now is ignored");
            }
        }
        catch (InvalidOperationException e) { return new Outcome("failure", "not applied: the bot pass could not be read: " + e.Message); }
        var started = DateTime.UtcNow;
        try { tasks.Start(env.BotPassTask); }
        catch (InvalidOperationException e) { return new Outcome("failure", "not applied: the bot pass did not start: " + e.Message); }
        log($"the task {env.BotPassTask} started; waiting up to {env.BotPassSeconds} s for it to end");

        var deadline = started + TimeSpan.FromSeconds(env.BotPassSeconds);
        TaskInfo info;
        while (true)
        {
            try { info = tasks.Info(env.BotPassTask); }
            catch (InvalidOperationException e) { return new Outcome("failure", "not applied: the bot pass could not be read: " + e.Message); }
            // Ended: Task Scheduler has a run newer than the one it had before
            // the start, and it is not running now. Its own record is set
            // against its own record, never against the agent's clock: on the
            // box it writes a run down 13 to 15 s before the time the agent
            // read just before starting it, so "began at or after the start"
            // never held, and a pass that ended OK in 15 s was waited on for
            // the whole limit (Deployments 7480554210 and 7482471512, #5380).
            // The run before is settled: a running task is refused above.
            var ran = info.LastRun > before.LastRun;
            if (info.State is not ("Running" or "Queued") && ran) break;
            if (DateTime.UtcNow > deadline)
            {
                // What it had got to, so a pass that runs out says where
                // (Deployment 7480554210 said only that it ran out).
                log($"Task Scheduler at the limit: {info.State}, last run {info.LastRun:yyyy-MM-dd HH:mm:ss}Z" + (ran ? ", this run" : $", the run it had before this start ({before.LastRun:yyyy-MM-dd HH:mm:ss}Z), so this start never ran"));
                try { tasks.End(env.BotPassTask); log("the bot pass was still running at its time limit and was stopped"); }
                catch (InvalidOperationException e) { log("the bot pass was still running at its time limit and could not be stopped: " + e.Message); }
                SayWhereItGot(log);
                return new Outcome("failure", $"not applied: the bot pass did not end within {env.BotPassSeconds} s");
            }
            try { await Task.Delay(Tick, ct); } catch (OperationCanceledException) { tasks.End(env.BotPassTask); throw; }
        }

        PassResult? r = null;
        try
        {
            var fi = new FileInfo(ResultPath);
            if (fi.Exists && fi.Length <= 1 << 20) r = JsonSerializer.Deserialize<PassResult>(Files.ReadShared(ResultPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            else if (fi.Exists) why = "its result.json is over 1 MB";
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { why = "its result.json does not read: " + e.Message; }
        if (r == null || r.Schema != 1)
        {
            why = why != "" ? why : r == null ? "it wrote no result.json" : $"its result.json is schema {r.Schema}, and this agent reads 1";
            SayWhereItGot(log);
            return new Outcome("failure", $"not applied: the bot pass ended (Task Scheduler says {info.LastResult}) and {why}; its log is {ServerLogPath}");
        }
        // Network addresses stay on the box, as in a server log (Server.Redact).
        foreach (var l in r.Lines) l.Detail = Server.Redact([l.Detail]).First();
        foreach (var l in r.Lines) log($"  {(l.Ok ? "PASS" : "FAIL")}  {l.Step}: {l.Detail}");
        var bad = r.Lines.FirstOrDefault(l => !l.Ok);
        if (r.Ok && bad == null && r.Lines.Count > 0)
            return new Outcome("success", $"bot pass: {r.Lines.Count} of {r.Lines.Count} passed");
        log("--- the copy's server said, last lines ---");
        foreach (var l in Server.Redact(r.Tail)) log("  " + l);
        return new Outcome("failure", bad != null ? $"not applied: the bot pass failed at {bad.Step}: {bad.Detail}" : "not applied: the bot pass says it failed and names no step");
    }

    Turn? TakeTurn(Action<string> log, out string why)
    {
        why = "";
        try { return Turn.Take(env.Turn, "the deploy agent's bot pass copy", TimeSpan.FromSeconds(env.TurnSeconds), log); }
        catch (Exception e) when (e is TimeoutException or IOException or UnauthorizedAccessException) { why = e.Message; return null; }
    }

    /// <summary>The copy, made fresh: "" when it is ready, else why not.</summary>
    public string Prepare(IReadOnlyDictionary<string, string> files, IReadOnlyCollection<string> bot, Action<string> log, string? serverZip = null, string passName = "")
    {
        if (!Directory.Exists(RunDir)) return $"{RunDir} is not there; Install-DeployAgent.ps1 makes it with the task";
        // The folder stays, with the rights the installer gave the task on it;
        // what is in it is the last pass's and goes, once its logs are kept.
        KeepLast(log);
        foreach (var d in Directory.EnumerateDirectories(RunDir)) Directory.Delete(d, true);
        foreach (var f in Directory.EnumerateFiles(RunDir)) File.Delete(f);
        File.WriteAllText(Path.Combine(RunDir, PassName), PlainName(passName));

        var dev = env.Root;
        var settings = JsonNode.Parse(File.ReadAllText(Path.Combine(dev, "server-settings.json")).TrimStart('﻿'))?.AsObject()
            ?? throw new InvalidDataException("dev's server-settings.json is not an object");

        // The engine: dev's, or the server build the Deployment swaps dev
        // onto, whose fork files (data\scripts among them) go in after the
        // data folder below.
        if (serverZip == null)
        {
            foreach (var name in new[] { "scam_native.node", "package.json" })
            {
                var at = Path.Combine(dev, name);
                if (File.Exists(at)) Files.Copy(at, Path.Combine(ServerDir, name));
                else if (name == "scam_native.node") return "dev has no scam_native.node";
            }
            var back = Path.Combine(dev, "dist_back");
            if (!File.Exists(Path.Combine(back, "skymp5-server.js"))) return "dev has no dist_back\\skymp5-server.js";
            CopyTree(back, Path.Combine(ServerDir, "dist_back"), _ => true);
        }
        foreach (var dll in Directory.EnumerateFiles(dev, "*.dll")) Files.Copy(dll, Path.Combine(ServerDir, Path.GetFileName(dll)));
        foreach (var n in Server.ReloadFiles) Files.Copy(files[n], Path.Combine(ServerDir, n));
        foreach (var n in bot) Files.Copy(files[n], Path.Combine(BotDir, n));
        // The tables the gamemode reads beside it (#5191): the Release's, or,
        // when it carries none, dev's own, which the Deployment leaves in place.
        var devTables = Path.Combine(dev, Tables.Dir);
        if (files.TryGetValue(Tables.Zip, out var tablesZip)) Tables.Expand(tablesZip, Path.Combine(ServerDir, Tables.Dir));
        else if (Directory.Exists(devTables)) Tables.CopyDir(devTables, Path.Combine(ServerDir, Tables.Dir));

        // The data folder, without the game files, which are read where the
        // bot pass keeps them.
        var dataSetting = settings["dataDir"]?.GetValue<string>() ?? "data";
        var devData = Path.IsPathRooted(dataSetting) ? dataSetting : Path.Combine(dev, dataSetting);
        if (!Directory.Exists(devData)) return $"dev's data folder {devData} is not there";
        var devScripts = Path.Combine(devData, "scripts") + Path.DirectorySeparatorChar;
        CopyTree(devData, Path.Combine(ServerDir, "data"), f =>
            !GameFileKinds.Contains(Path.GetExtension(f).ToLowerInvariant()) && !AgentOrServerMade(Path.GetFileName(f)) &&
            !(serverZip != null && f.StartsWith(devScripts, StringComparison.OrdinalIgnoreCase)));
        if (serverZip != null)
        {
            var sums = ServerBuild.Expand(serverZip, ServerDir, out _);
            if (!sums.ContainsKey("scam_native.node") || !sums.ContainsKey("dist_back/skymp5-server.js"))
                return "the new server build has no scam_native.node or dist_back\\skymp5-server.js";
            log($"the copy runs the new server build ({sums.Count} fork file(s)), not dev's");
        }

        string Resolve(string entry) => Path.IsPathRooted(entry) || entry.Contains(":\\") ? entry : Path.Combine(devData, entry);
        var order = settings["loadOrder"] is JsonArray lo ? lo.Select(x => x!.GetValue<string>()).ToList() : FiveMasters.ToList();
        var copied = 0;
        var placed = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string Cache(string entry, string what)
        {
            var from = Resolve(entry);
            var name = Path.GetFileName(from.Replace('\\', '/').TrimEnd('/'));
            if (!File.Exists(from)) throw new InvalidDataException($"{entry} is in dev's {what} but not on disk at {from}");
            if (placed.TryGetValue(name, out var other) && !string.Equals(other, from, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"dev's {what} names two files called {name} ({other} and {from})");
            placed[name] = from;
            var to = Path.Combine(PluginDir, name);
            var src = new FileInfo(from);
            var have = new FileInfo(to);
            if (!have.Exists || have.Length != src.Length || have.LastWriteTimeUtc != src.LastWriteTimeUtc)
            {
                Files.Copy(from, to);
                File.SetLastWriteTimeUtc(to, src.LastWriteTimeUtc);
                copied++;
            }
            return to;
        }
        var newOrder = new JsonArray();
        foreach (var p in order) newOrder.Add(Cache(p, "load order"));
        settings["loadOrder"] = newOrder;
        if (settings["archives"] is JsonArray ar)
        {
            var newAr = new JsonArray();
            foreach (var a in ar) newAr.Add(Cache(a!.GetValue<string>(), "archives"));
            settings["archives"] = newAr;
        }
        log($"the copy reads {placed.Count} plugin and archive file(s) from {PluginDir}; {copied} were new or changed on dev");

        // Its ports, away from every server's and from what is in use now.
        var (udp, tcp) = InUse();
        var reserved = new HashSet<int> { 7777, 7778, 3000, 7787, 7788, 7789 };
        foreach (var k in new[] { "port", "thornswoodVoicePort" })
            if (settings[k] is JsonValue v && v.TryGetValue<int>(out var n)) { reserved.Add(n); reserved.Add(n + 1); }
        int port = 0, voice = 0;
        for (var c = 7900; c <= 7996 && port == 0; c++)
        {
            if (reserved.Contains(c) || reserved.Contains(c + 1) || udp.Contains(c) || tcp.Contains(c) || tcp.Contains(c + 1)) continue;
            port = c;
        }
        if (port == 0) return "no free port from 7900 to 7996 for the copy";
        for (var c = port + 2; c <= 7998 && voice == 0; c++)
            if (!reserved.Contains(c) && !tcp.Contains(c)) voice = c;
        if (voice == 0) return $"no free voice port above {port}";

        foreach (var k in Dropped) settings.Remove(k);
        settings["port"] = port;
        settings["thornswoodVoicePort"] = voice;
        settings["thornswoodRequirePass"] = false;
        settings["offlineMode"] = true;
        settings["master"] = "";
        settings["password"] = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        settings["name"] = (settings["name"]?.GetValue<string>() ?? "Thornswood") + " (bot pass)";
        settings["dataDir"] = "data";
        settings["privDir"] = "private";
        settings["databaseDriver"] = "file";
        settings["databaseName"] = "world";
        Directory.CreateDirectory(Path.Combine(ServerDir, "private"));
        Files.WriteWhole(Path.Combine(ServerDir, "server-settings.json"),
            JsonSerializer.SerializeToUtf8Bytes(settings, new JsonSerializerOptions { WriteIndented = true }));
        log($"the copy is ready in {ServerDir}: game port {port}, resources {port + 1}, voice {voice}, an empty world, no private folder of dev's");
        return "";
    }

    static void CopyTree(string from, string to, Func<string, bool> take)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.EnumerateFiles(from))
            if (take(f)) Files.Copy(f, Path.Combine(to, Path.GetFileName(f)));
        foreach (var d in Directory.EnumerateDirectories(from))
            CopyTree(d, Path.Combine(to, Path.GetFileName(d)), take);
    }
}
