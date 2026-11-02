#nullable enable
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Thornswood.DeployAgent;

/// <summary>How an apply went, in the words a Deployment status takes:
/// success; failure (refused or did not take, and the server runs what it ran
/// before); error (the server may not run what it ran before, or the agent
/// could not finish).</summary>
public sealed record Outcome(string State, string Summary, string Blob = "", string Prev = "");

/// <summary>One game server folder the agent applies a gamemode to.</summary>
public sealed class Server(EnvConfig env, HttpClient http)
{
    public EnvConfig Env => env;
    public TimeSpan Tick { get; set; } = TimeSpan.FromMilliseconds(500);
    public Func<DateTime> Now { get; set; } = () => DateTime.Now;

    /// <summary>The files a reload puts in, in order: the stamp first, so the
    /// gamemode is never loaded beside a stamp naming the one before it.</summary>
    public static readonly string[] ReloadFiles = ["thornswood-build.json", "gamemode.js"];

    string Root => env.Root;

    JsonElement Settings()
    {
        var text = File.ReadAllText(Path.Combine(Root, "server-settings.json")).TrimStart('﻿');
        using var d = JsonDocument.Parse(text);
        return d.RootElement.Clone();
    }

    /// <summary>Where the server keeps what it serves on its resources port.</summary>
    public string DataDir()
    {
        var d = "data";
        try { if (Settings().TryGetProperty("dataDir", out var v) && v.GetString() is { Length: > 0 } s) d = s; } catch (Exception e) when (e is IOException or JsonException) { }
        return Path.IsPathRooted(d) ? d : Path.Combine(Root, d);
    }

    /// <summary>Asks the health address once. The game server serves it from
    /// the process that loads the gamemode, so a 200 says that process runs and
    /// answers (Watch-Services.ps1 asks the same address).</summary>
    public async Task<string> Unhealthy(CancellationToken ct)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(15));
            using var res = await http.GetAsync(env.Health, cts.Token);
            return (int)res.StatusCode == 200 ? "" : $"{env.Health} answered HTTP {(int)res.StatusCode}";
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return $"{env.Health} did not answer: {e.Message}";
        }
    }

    /// <summary>Why this server cannot take a reload, touching nothing, or ""
    /// when it can. The checks Reload.ps1 and Deploy-DevGamemode.ps1 make.</summary>
    async Task<string> Refusal(Action<string> log, CancellationToken ct)
    {
        JsonElement st;
        try { st = Settings(); }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { return "the server's settings do not read: " + e.Message; }
        var port = st.TryGetProperty("port", out var p) && p.ValueKind == JsonValueKind.Number ? p.GetInt32() : 0;
        if (env.LivePort != 0 && port == env.LivePort) return $"{Root} is on port {port}, which is the live server";
        if (env.RequirePort != 0 && port != env.RequirePort) return $"{Root} is on port {port}, not {env.RequirePort}, so it is not the server this environment names";
        var gp = "gamemode.js";
        if (Directory.Exists(Path.Combine(Root, "skymp5-gamemode"))) gp = Path.Combine("skymp5-gamemode", "gamemode.js");
        if (st.TryGetProperty("gamemodePath", out var g) && g.GetString() is { Length: > 0 } gs) gp = gs;
        if (!Path.IsPathRooted(gp)) gp = Path.Combine(Root, gp);
        if (Path.GetFullPath(gp) != Path.GetFullPath(Path.Combine(Root, "gamemode.js")))
            return $"the server loads its gamemode from {gp}, not {Path.Combine(Root, "gamemode.js")}";
        var engine = Path.Combine(Root, "dist_back", "skymp5-server.js");
        try
        {
            if (!File.ReadAllText(engine).Contains("[thornswood] gamemode did not load; the error is above"))
                return "the engine on the box does not say how a gamemode load went (it needs the fork from Thornswood #3196)";
        }
        catch (IOException e) { return $"the engine at {engine} does not read: {e.Message}"; }
        var sick = await Unhealthy(ct);
        if (sick != "")
        {
            log("health: " + sick);
            return "the server does not answer its health address, so it is not running; the agent reloads a running server only";
        }
        return "";
    }

    /// <summary>Puts a new gamemode.js and its stamp into a running server and
    /// holds the server to loading it, the way Reload.ps1 does:
    ///  - the server folders' turn first (#3247), held to the end;
    ///  - what it replaces is copied into &lt;root&gt;\.prev-&lt;stamp&gt; (gamemode.js,
    ///    thornswood-build.json, server-settings.json, the deploy record and the
    ///    gamemode-tables folder), the set a swap keeps, so
    ///    Deploy-DevGamemode.ps1 -PutBack puts it back;
    ///  - each new file is staged in &lt;root&gt;\.agent-stage-&lt;stamp&gt; and moved
    ///    over the old one in one rename: the tables folder first (#5191), then
    ///    the stamp, then gamemode.js, whose arrival is what the server reloads
    ///    on, so the reload reads the new tables;
    ///  - server.log has to say the new blob and the new tables tree loaded,
    ///    then the health address has to answer;
    ///  - when either does not happen the old files go back the same way and
    ///    the old blob has to load again. Only if that fails too is the server
    ///    left for a restart, which this slice does not make, and it says so.</summary>
    public async Task<Outcome> ApplyGamemode(IReadOnlyDictionary<string, string> files, string who, Action<string> log, CancellationToken ct)
    {
        foreach (var n in ReloadFiles)
            if (!files.ContainsKey(n)) return new Outcome("failure", "the Release's gamemode part has no " + n);
        var why = await Refusal(log, ct);
        if (why != "") return new Outcome("failure", "not applied: " + why);
        Turn turn;
        try { turn = Turn.Take(env.Turn, who, TimeSpan.FromSeconds(env.TurnSeconds), log); }
        catch (Exception e) when (e is TimeoutException or IOException or UnauthorizedAccessException) { return new Outcome("failure", "not applied: " + e.Message); }
        using var _ = turn;

        var stamp = Swap.FreeStamp(Root, Now());
        var prevName = ".prev-" + stamp;
        var prev = Path.Combine(Root, prevName);
        // Not .stage-*: Deploy-DevGamemode.ps1 clears every .stage-* it finds
        // before it takes the turn. Inside the root, so a file moved in carries
        // the root's permissions, which the server's account reads.
        var stage = Path.Combine(Root, ".agent-stage-" + stamp);
        var gm = Path.Combine(Root, "gamemode.js");
        var tablesAt = Path.Combine(Root, Tables.Dir);

        try
        {
            foreach (var rel in ReloadFiles.Append("server-settings.json"))
            {
                var at = Path.Combine(Root, rel);
                if (File.Exists(at)) Files.Copy(at, Path.Combine(prev, rel));
            }
            var rec = Path.Combine(DataDir(), "thornswood-deploy.json");
            var relRec = Path.GetRelativePath(Root, rec);
            if (!relRec.StartsWith("..") && File.Exists(rec)) Files.Copy(rec, Path.Combine(prev, relRec));
            if (Directory.Exists(tablesAt)) Tables.CopyDir(tablesAt, Path.Combine(prev, Tables.Dir));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            TryDelete(prev);
            return new Outcome("failure", $"not applied: the running files could not be kept in {prevName}: {e.Message}");
        }
        var withTables = files.ContainsKey(Tables.Zip);
        try
        {
            foreach (var rel in ReloadFiles) Files.Copy(files[rel], Path.Combine(stage, rel));
            if (withTables) Tables.Expand(files[Tables.Zip], Path.Combine(stage, Tables.Dir));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            TryDelete(stage);
            return new Outcome("failure", "not applied: the new files could not be staged: " + e.Message, Prev: prevName);
        }

        var oldBlob = Files.GamemodeBlob(gm);
        var newBlob = Files.GamemodeBlob(Path.Combine(stage, "gamemode.js"));
        var oldTree = Tables.Tree(tablesAt);
        // A Release from before #5191 carries no tables and leaves the folder as it is.
        var newTree = withTables ? Tables.Tree(Path.Combine(stage, Tables.Dir)) : oldTree;
        var changes = oldBlob != newBlob || oldTree != newTree;
        // A load is held to a tables tree only when the gamemode loading it
        // reads tables, which is known from that gamemode.js and not from the
        // folder: a gamemode from before #5191 beside a folder a later one
        // left logs no tree, and a Release put back across #5191 is one.
        var newHeld = Tables.Reads(Path.Combine(stage, "gamemode.js")) ? newTree : "";
        var oldHeld = Tables.Reads(gm) ? oldTree : "";
        log($"the running gamemode is git blob {oldBlob}" + (oldTree != "" ? $" with tables tree {oldTree}" : "") + $"; it, its stamp and its tables are kept in {prevName}");

        var sl = new ServerLog(Root);
        sl.Mark();
        var placed = new List<string>();
        why = "";
        // The tables first: the running gamemode read its own once, as it
        // loaded, so the folder can change under it, and the reload that
        // gamemode.js's arrival starts reads the new one.
        if (withTables)
        {
            why = SwapTables(Path.Combine(stage, Tables.Dir), tablesAt, Path.Combine(stage, Tables.Dir + ".old"));
            if (why == "") placed.Add(Tables.Dir);
        }
        foreach (var rel in why == "" ? ReloadFiles : [])
        {
            // While the engine runs and reads gamemode.js: a rename readers
            // cannot refuse (Files.Into), not MoveFileEx, which any open
            // handle on the old file refuses.
            try { Files.Into(Path.Combine(stage, rel), Path.Combine(Root, rel)); placed.Add(rel); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { why = $"could not put the new {rel} in place: {e.Message}"; break; }
        }
        var wait = TimeSpan.FromSeconds(env.LoadSeconds);
        if (why == "" && !changes) log($"the server already runs git blob {newBlob}" + (newTree != "" ? $" with tables tree {newTree}" : "") + ", so it has nothing to load; the stamp is the new one");
        if (why == "" && changes)
        {
            log($"put in git blob {newBlob}" + (newTree != "" ? $" and tables tree {newTree} ({Tables.Count(tablesAt)} tables)" : "") + $", waiting up to {env.LoadSeconds} seconds for server.log to say they loaded");
            var (got, said) = sl.AwaitLoad(newBlob, newHeld, wait, Tick);
            foreach (var l in Redact(said)) log("  " + l);
            if (got != "") why = "the new gamemode did not take: " + got;
        }
        if (why == "")
        {
            var sick = await Unhealthy(ct);
            if (sick != "") why = "the health check failed after the load: " + sick;
            else log($"health: {env.Health} answers 200");
        }
        if (why == "")
        {
            TryDelete(stage);
            PruneOld(log);
            return new Outcome("success", $"dev runs gamemode blob {newBlob[..12]}" + (newTree != "" ? $" with tables tree {newTree[..12]}" : "") + ", reloaded with nobody dropped", newBlob, prevName);
        }

        // The way back: the old files from their copies in .prev, through the
        // stage, in the reverse order, and the old gamemode has to load again.
        log(why);
        if (changes && placed.Count > 0)
        {
            log("--- server.log since the new gamemode went in, last lines ---");
            foreach (var l in Redact(sl.Tail)) log("  " + l);
        }
        log("putting the previous files back");
        var clean = true;
        sl.Mark();
        // The tables go back first, as they went in first: the old gamemode.js
        // arriving is what starts the reload, and that load reads the folder,
        // so it has to be the old one by then. The files follow in the reverse
        // of the order they went in.
        var undo = placed.Where(r => r == Tables.Dir).Concat(Enumerable.Reverse(placed).Where(r => r != Tables.Dir)).ToList();
        foreach (var rel in undo)
        {
            var kept = Path.Combine(prev, rel);
            if (rel == Tables.Dir)
            {
                // The old folder back through the stage, or none when there was none.
                var back = Path.Combine(stage, Tables.Dir + ".back");
                var off = Path.Combine(stage, Tables.Dir + ".undone");
                try { if (Directory.Exists(kept)) Tables.CopyDir(kept, back); }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log($"COULD NOT PUT THE OLD {rel} BACK: {e.Message}"); clean = false; continue; }
                var swapWhy = Directory.Exists(back) ? SwapTables(back, tablesAt, off) : MoveAside(tablesAt, off);
                if (swapWhy != "") { log($"COULD NOT PUT THE OLD {rel} BACK: {swapWhy}"); clean = false; }
                continue;
            }
            if (!File.Exists(kept)) continue;
            try
            {
                Files.Copy(kept, Path.Combine(stage, rel));
                Files.Into(Path.Combine(stage, rel), Path.Combine(Root, rel));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                log($"COULD NOT PUT THE OLD {rel} BACK: {e.Message}");
                clean = false;
            }
        }
        TryDelete(stage);
        if (clean)
        {
            var now = Files.GamemodeBlob(gm);
            var nowTree = Tables.Tree(tablesAt);
            if (now != oldBlob) { log($"gamemode.js is git blob {now} after the put-back, not the old {oldBlob}"); clean = false; }
            else if (nowTree != oldTree) { log($"the tables are git tree {nowTree} after the put-back, not the old {oldTree}"); clean = false; }
            else if (changes && placed.Contains("gamemode.js"))
            {
                log($"the old gamemode is back on disk, waiting up to {env.LoadSeconds} seconds for the server to load it");
                var (got, said) = sl.AwaitLoad(oldBlob, oldHeld, wait, Tick);
                foreach (var l in Redact(said)) log("  " + l);
                if (got != "") { log("the old gamemode did not take either: " + got); clean = false; }
            }
        }
        return clean
            ? new Outcome("failure", Trim(why) + "; the previous gamemode is back and loaded", oldBlob, prevName)
            : new Outcome("error", Trim(why) + "; putting the old one back did not take either, so dev needs Deploy-DevGamemode.ps1 -PutBack", Prev: prevName);
    }

    // ---- a new server build: stop, swap, start under a hold ------------------

    /// <summary>Stops and starts the server; Swap.ps1's ways, on the box.</summary>
    public IServerControl Control { get; set; } = new WindowsServerControl();
    /// <summary>How long a stopped process may take to exit (StopAndMove.ps1).</summary>
    public TimeSpan ExitWithin { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>The record of the build the server folder runs (its
    /// server-build.json, which every server deploy leaves beside the files),
    /// as its sum, or "" when there is none.</summary>
    public string RunningRecordSum()
    {
        var p = Path.Combine(Root, "server-build.json");
        return File.Exists(p) ? ServerBuild.RecordSum(Files.ReadShared(p)) : "";
    }

    /// <summary>Puts a new server build (an engine pin's) and the gamemode
    /// written for it into the server, the way Swap.ps1's swap block does:
    ///  - the stage first, while the old server runs: every fork file out of
    ///    the zip held to the record, the record the one the signed manifest
    ///    names, and the engine one that says how a gamemode load went;
    ///  - then the server folders' turn (#3247) and a hold (#5155), so the
    ///    nightly backup and the watchdog stay out until it ends;
    ///  - the stop: the process on this server's own UDP port, waited for
    ///    until it has exited, and a restart.json it never read removed;
    ///  - one rename per file, what it replaces into .prev-&lt;stamp&gt;, and any
    ///    fork file the new record does not list moved there too;
    ///  - the start, then both ports, server.log saying the new gamemode
    ///    loaded, and the health address;
    ///  - when any of that does not happen, the stop again, the old files
    ///    back the same way, and the old server started and asked again.
    /// files are the Release's gamemode part (gamemode.js, its stamp and, from
    /// #5191, gamemode-tables.zip, whose folder is swapped with the files).</summary>
    public async Task<Outcome> ApplyServerBuild(string zip, byte[] record, IReadOnlyDictionary<string, string> files, string who, Action<string> log, CancellationToken ct)
    {
        foreach (var n in ReloadFiles)
            if (!files.ContainsKey(n)) return new Outcome("failure", "the Release's gamemode part has no " + n);
        if (env.Task == "") return new Outcome("failure", "not applied: no scheduled task is named for this server, so the agent cannot stop and start it for a new server build");
        JsonElement st;
        try { st = Settings(); }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { return new Outcome("failure", "not applied: the server's settings do not read: " + e.Message); }
        var port = st.TryGetProperty("port", out var pv) && pv.ValueKind == JsonValueKind.Number ? pv.GetInt32() : 0;
        if (port <= 0) return new Outcome("failure", "not applied: the server's settings name no port, so there is no telling which process is this server");
        if (env.LivePort != 0 && port == env.LivePort) return new Outcome("failure", $"not applied: {Root} is on port {port}, which is the live server");
        if (env.RequirePort != 0 && port != env.RequirePort) return new Outcome("failure", $"not applied: {Root} is on port {port}, not {env.RequirePort}, so it is not the server this environment names");
        // skymp5-server/ts/ui.ts: 3000 when the game port is 7777, the game port plus one otherwise.
        var resPort = port == 7777 ? 3000 : port + 1;
        ServerBuild.Record rec;
        try { rec = ServerBuild.Read(record); }
        catch (Exception e) when (e is JsonException or DecoderFallbackException) { return new Outcome("failure", "not applied: the Release's server-build.json does not read: " + e.Message); }

        var stamp = Swap.FreeStamp(Root, Now());
        var prevName = ".prev-" + stamp;
        var prev = Path.Combine(Root, prevName);
        var stage = Path.Combine(Root, ".agent-stage-" + stamp);

        // The stage, while the old server runs. A refusal here has touched nothing.
        Dictionary<string, string> sums;
        try
        {
            sums = ServerBuild.Expand(zip, stage, out var zipRecord);
            if (ServerBuild.RecordSum(zipRecord) != ServerBuild.RecordSum(record))
                throw new InvalidDataException("the zip's server-build.json is not the one the signed manifest names");
            Files.WriteWhole(Path.Combine(stage, "server-build.json"), record);
            foreach (var rel in ReloadFiles) Files.Copy(files[rel], Path.Combine(stage, rel));
            if (files.ContainsKey(Tables.Zip)) Tables.Expand(files[Tables.Zip], Path.Combine(stage, Tables.Dir));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            TryDelete(stage);
            return new Outcome("failure", "not applied: the new server build could not be staged: " + e.Message);
        }
        var bad = ServerBuild.Problems(rec, sums, "the Release's server build");
        try
        {
            if (!File.ReadAllText(Path.Combine(stage, "dist_back", "skymp5-server.js")).Contains("[thornswood] gamemode did not load; the error is above"))
                bad.Add("the new engine does not say how a gamemode load went (it needs the fork from Thornswood #3196)");
        }
        catch (IOException e) { bad.Add("the new engine does not read: " + e.Message); }
        if (bad.Count > 0)
        {
            foreach (var b in bad) log("REFUSED: " + b);
            TryDelete(stage);
            return new Outcome("failure", "not applied: the server build is not the one its record names: " + bad[0]);
        }
        var want = sums.Keys.Append("server-build.json").Concat(ReloadFiles).ToList();
        var newBlob = Files.GamemodeBlob(Path.Combine(stage, "gamemode.js"));
        var tablesAt = Path.Combine(Root, Tables.Dir);
        var withTables = files.ContainsKey(Tables.Zip);
        // A Release from before #5191 carries no tables and leaves the folder as it is.
        var newTree = withTables ? Tables.Tree(Path.Combine(stage, Tables.Dir)) : Tables.Tree(tablesAt);
        // Held only when the new gamemode reads tables (see ApplyGamemode).
        var newHeld = Tables.Reads(Path.Combine(stage, "gamemode.js")) ? newTree : "";
        log($"the stage checks out: server build {rec.Short}, {sums.Count} file(s) held to its record, and gamemode git blob {newBlob}" +
            (newTree != "" ? $" with tables tree {newTree}" : ""));

        Turn turn;
        try { turn = Turn.Take(env.Turn, who, TimeSpan.FromSeconds(env.TurnSeconds), log); }
        catch (Exception e) when (e is TimeoutException or IOException or UnauthorizedAccessException) { TryDelete(stage); return new Outcome("failure", "not applied: " + e.Message); }
        using var _ = turn;
        Hold.Set(env.Watch, env.Task, $"the deploy agent is swapping in server build {rec.Short} at {Root}", who, 30, log);
        try
        {
            var stopWhy = StopServer(port, log);
            if (stopWhy != "")
            {
                TryDelete(stage);
                return new Outcome("error", $"not applied: {stopWhy}, so nothing was swapped; the old files are in place and the watchdog starts the server once the hold is gone");
            }

            // The fork files the new record does not list go aside too, so the
            // folder is one build, the way a whole install leaves it.
            var stale = ServerBuild.FolderForkFiles(Root).Where(r => !sums.ContainsKey(r)).ToList();
            var placed = new List<string>();
            var aside = new List<string>();
            var why = "";
            // The tables folder goes aside into .prev whole and the new one in,
            // two renames, while the server is stopped.
            var tablesAside = false;
            var tablesPlaced = false;
            if (withTables)
            {
                try
                {
                    if (Directory.Exists(tablesAt)) { Directory.CreateDirectory(prev); Directory.Move(tablesAt, Path.Combine(prev, Tables.Dir)); tablesAside = true; }
                    Directory.Move(Path.Combine(stage, Tables.Dir), tablesAt);
                    tablesPlaced = true;
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException) { why = $"could not swap {Tables.Dir}: {e.Message}"; }
            }
            foreach (var rel in why == "" ? want.Concat(stale) : [])
            {
                var at = Path.Combine(Root, rel);
                try
                {
                    if (File.Exists(at))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(prev, rel))!);
                        File.Move(at, Path.Combine(prev, rel));
                        aside.Add(rel);
                    }
                    if (stale.Contains(rel)) continue;
                    Directory.CreateDirectory(Path.GetDirectoryName(at)!);
                    File.Move(Path.Combine(stage, rel), at);
                    placed.Add(rel);
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException) { why = $"could not swap {rel}: {e.Message}"; break; }
            }
            if (why == "")
            {
                log($"swapped in {placed.Count} file(s); the ones they replaced are in {prevName}");
                why = await StartAndCheck(port, resPort, newBlob, newHeld, log, ct);
            }
            if (why == "")
            {
                TryDelete(stage);
                PruneOld(log);
                return new Outcome("success", $"dev runs server build {rec.Short} and gamemode blob {newBlob[..12]}" + (newTree != "" ? $" with tables tree {newTree[..12]}" : "") + ", restarted", newBlob, prevName);
            }

            // The way back: stop what was started, the new files out, the old ones in, and the old server started.
            log(why);
            log("putting the previous server build back");
            var clean = StopServer(port, log) == "";
            for (int i = want.Count + stale.Count - 1; i >= 0; i--)
            {
                var rel = i < want.Count ? want[i] : stale[i - want.Count];
                var at = Path.Combine(Root, rel);
                try
                {
                    if (placed.Contains(rel) && File.Exists(at))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(stage, rel))!);
                        File.Move(at, Path.Combine(stage, rel), true);
                    }
                    if (aside.Contains(rel))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(at)!);
                        File.Move(Path.Combine(prev, rel), at);
                    }
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log($"COULD NOT PUT THE OLD {rel} BACK: {e.Message}"); clean = false; }
            }
            try
            {
                if (tablesPlaced && Directory.Exists(tablesAt)) Directory.Move(tablesAt, Path.Combine(stage, Tables.Dir));
                if (tablesAside) Directory.Move(Path.Combine(prev, Tables.Dir), tablesAt);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log($"COULD NOT PUT THE OLD {Tables.Dir} BACK: {e.Message}"); clean = false; }
            if (clean)
            {
                var backGm = Path.Combine(Root, "gamemode.js");
                var back = await StartAndCheck(port, resPort, Files.GamemodeBlob(backGm), Tables.Reads(backGm) ? Tables.Tree(tablesAt) : "", log, ct);
                if (back != "") { log("the previous server build is back and does not answer either: " + back); clean = false; }
                else log("the previous server build is back and answering");
            }
            if (clean)
            {
                TryDelete(stage);
                TryDelete(prev);
                return new Outcome("failure", Trim(why) + "; the previous server build is back and answering");
            }
            return new Outcome("error", Trim(why) + $"; putting the old build back did not take either: what it replaced is in {prevName}, and dev needs Publish-Server -PutBack", Prev: prevName);
        }
        finally { Hold.Clear(env.Watch, env.Task, log); }
    }

    /// <summary>Stops whatever holds this server's UDP port and waits for it
    /// to exit, then removes a restart.json the old process never read (the
    /// next process would count down on its own). "" when the port is free.</summary>
    string StopServer(int port, Action<string> log)
    {
        List<int> pids;
        try { pids = Control.UdpHolders(port); }
        catch (ControlException e) { return $"the UDP ports could not be listed to find what holds {port} ({e.Message})"; }
        log($"stopping whatever holds UDP {port}" + (pids.Count > 0 ? $": pid {string.Join(", ", pids)}" : ", which nothing does"));
        var left = Control.Stop(env.Task, pids, ExitWithin);
        foreach (var l in left) log(l);
        if (left.Count > 0) return "what the stop ended has not all exited, so its files may still be open";
        try
        {
            var still = Control.UdpHolders(port);
            if (still.Count > 0) return $"UDP {port} is still held by pid {string.Join(", ", still)} after the stop";
        }
        catch (ControlException e) { return $"the UDP ports could not be listed after the stop ({e.Message})"; }
        var rq = Path.Combine(DataDir(), "restart.json");
        try { if (File.Exists(rq)) { File.Delete(rq); log("removed a restart.json the old process never read"); } }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log($"COULD NOT REMOVE {rq}, so the new process may count down on its own: {e.Message}"); }
        return "";
    }

    /// <summary>Starts the task, then waits for both ports (UDP held, the
    /// resources port taking a connection), server.log saying the gamemode
    /// blob and its tables tree loaded, and the health address. "" when all
    /// of them did.</summary>
    async Task<string> StartAndCheck(int port, int resPort, string blob, string tree, Action<string> log, CancellationToken ct)
    {
        var sl = new ServerLog(Root);
        sl.Mark();
        try { Control.Start(env.Task); }
        catch (ControlException e) { return $"the task {env.Task} did not start: {e.Message}"; }
        log($"started, giving it {env.StartSeconds} seconds to answer on UDP {port} and on {resPort}");
        var until = Now() + TimeSpan.FromSeconds(env.StartSeconds);
        var listWhy = "";
        while (true)
        {
            var udp = false;
            try { udp = Control.UdpHolders(port).Count > 0; listWhy = ""; }
            catch (ControlException e) { listWhy = e.Message; }
            if (udp && Control.TcpAnswers(resPort)) break;
            if (Now() > until)
            {
                foreach (var l in Redact(sl.Lines().TakeLast(30))) log("  " + l);
                return $"nothing answered on UDP {port} and {resPort} within {env.StartSeconds} seconds" + (listWhy != "" ? $" (the ports could not be listed: {listWhy})" : "");
            }
            await Task.Delay(Tick, ct);
        }
        log($"answering on UDP {port} and {resPort}; waiting up to {env.LoadSeconds} seconds for server.log to say gamemode git blob {blob}" +
            (tree != "" ? $" and tables tree {tree}" : "") + " loaded");
        var (got, said) = sl.AwaitLoad(blob, tree, TimeSpan.FromSeconds(env.LoadSeconds), Tick);
        foreach (var l in Redact(said)) log("  " + l);
        if (got != "") return "the gamemode did not take on the new start: " + got;
        var sick = await Unhealthy(ct);
        if (sick != "") return "the health check failed after the start: " + sick;
        log($"health: {env.Health} answers 200");
        return "";
    }

    static string Trim(string s) => s.Length > 90 ? s[..87] + "..." : s;

    /// <summary>Puts the tables folder from into place at to, the one at to
    /// moved to aside first: two renames on the one volume. "" when it did;
    /// when the second rename fails the first is undone.</summary>
    static string SwapTables(string from, string to, string aside)
    {
        var had = Directory.Exists(to);
        try { if (had) Directory.Move(to, aside); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return $"could not move the running {Tables.Dir} aside: {e.Message}"; }
        try { Directory.Move(from, to); return ""; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            try { if (had) Directory.Move(aside, to); }
            catch (Exception e2) when (e2 is IOException or UnauthorizedAccessException) { return $"could not put the new {Tables.Dir} in place ({e.Message}), nor the running one back ({e2.Message})"; }
            return $"could not put the new {Tables.Dir} in place: {e.Message}";
        }
    }

    static string MoveAside(string dir, string aside)
    {
        try { if (Directory.Exists(dir)) Directory.Move(dir, aside); return ""; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return $"could not take {Tables.Dir} out: {e.Message}"; }
    }

    static void TryDelete(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    /// <summary>Keeps the newest two .prev and .undone folders, as a swap and a reload do.</summary>
    void PruneOld(Action<string> log)
    {
        foreach (var kind in new[] { ".prev-", ".undone-" })
        {
            var names = Directory.EnumerateDirectories(Root).Select(Path.GetFileName).Where(n => n!.StartsWith(kind))
                .OrderByDescending(n => n, StringComparer.Ordinal).Skip(2);
            foreach (var n in names)
            {
                try { Directory.Delete(Path.Combine(Root, n!), true); }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log($"PRUNE FAILED: could not remove {n}, one of the old copies past the newest 2: {e.Message}"); }
            }
        }
    }

    static readonly Regex Ipv4 = new(@"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b");

    /// <summary>Takes network addresses out of server.log lines before they go
    /// in a log anybody can read: who connects from where stays on the box.</summary>
    public static IEnumerable<string> Redact(IEnumerable<string> lines) => lines.Select(l => Ipv4.Replace(l, "<address>"));
}
