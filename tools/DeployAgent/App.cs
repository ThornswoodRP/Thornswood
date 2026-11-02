#nullable enable
using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Thornswood.DeployAgent;

/// <summary>The apps beside the game servers that a Release carries as a zip
/// of their own (#5190, #5187): the site and the Discord bot, each with its
/// own Deployment environment, and the voice service (applied with dev's).
/// scripts/release/App-Part.ps1 makes the zips; this puts one in.</summary>
public static class AppKinds
{
    public const string Site = "site";
    public const string Discord = "discord";
    /// <summary>The voice service, which has no Deployment of its own: the
    /// gamemode pushes positions to it, so it goes in with dev's (and later
    /// main's), from the same Release.</summary>
    public const string Voice = "voice";

    /// <summary>The Release part that carries the kind's zip, and its file name.</summary>
    public static string Part(string kind) => kind;
    public static string ZipName(string kind) => kind + ".zip";

    /// <summary>Whether the agent knows how to put this kind in.</summary>
    public static bool Known(string kind) => kind is Site or Discord or Voice;
}

/// <summary>Stopping, starting and checking an app, the ways Swap.ps1's
/// service swap and the deploy scripts' hooks use on the box
/// (Deploy-Docs.ps1, Install-Bot.ps1, Bot-Service.ps1). On the box it is
/// WindowsAppControl; a test stands one in.</summary>
public interface IAppControl
{
    /// <summary>"" when the app is set up on this box to take a swap, or why not.</summary>
    string NotInstalled(EnvConfig e);
    /// <summary>Stops the app and waits for what it stopped to exit. Lines say
    /// what it did; Left says what had not exited or could not be opened, so
    /// the files it held may still be open and nothing is moved.</summary>
    StopResult Stop(EnvConfig e, TimeSpan within);
    /// <summary>Starts it. Throws ControlException when it cannot.</summary>
    void Start(EnvConfig e);
    /// <summary>Whether the app's Windows service says Running ("" for an app that is a task).</summary>
    bool Running(EnvConfig e);
    /// <summary>"" when the program parses (node --check for .js, Python's own
    /// parser for .py, with the python the app runs), or why it does not.</summary>
    string Parse(EnvConfig e, string path);
    /// <summary>Installs the libraries requirements names into dir, the way a
    /// full Install-Bot run does, and has trustPy make the bot's roots from
    /// them. "" when they went in, or why not.</summary>
    string Libraries(EnvConfig e, string requirements, string dir, string trustPy);
}

public sealed record StopResult(List<string> Lines, List<string> Left);

/// <summary>One app folder the agent swaps a Release's zip into. The same two
/// halves as Swap.ps1's service swap, with what it replaces kept the same way
/// (.prev-&lt;stamp&gt;, the newest two), so Deploy-Docs.ps1 -PutBack and
/// Install-Bot.ps1 -PutBack put back what the agent put in:
///  1. the zip is opened into &lt;root&gt;\.agent-stage-&lt;stamp&gt; while the app runs,
///     every entry a plain path under the root, and only the files that
///     differ from what is there are kept; the programs are parsed and the
///     JSON read, and a refusal there touches nothing;
///  2. under a hold on the app (#5155), it is stopped and waited for until
///     what it ran has exited; each new file is moved in, what it replaces
///     into &lt;root&gt;\.prev-&lt;stamp&gt;, and so is what the Release no longer
///     has (the site's public files and pages) or what is not the app's own
///     (the bot's folder, Get-ThornswoodBotOwned);
///  3. it is started and has to answer: the site's front page, the bot's
///     log saying it is watching its server;
///  4. when it does not, it is stopped, everything goes back, and it is
///     started on the old files and asked again.</summary>
public sealed class App(EnvConfig env, HttpClient http, IAppControl control)
{
    public EnvConfig Env => env;
    public TimeSpan Tick { get; set; } = TimeSpan.FromMilliseconds(700);
    public Func<DateTime> Now { get; set; } = () => DateTime.Now;
    string Root => env.Root;

    static readonly Regex Segment = new(@"^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$");

    /// <summary>The names at the top of the bot's folder that are the bot's
    /// own besides what a Release sends (scripts/vps/Bot-Service.ps1,
    /// Get-ThornswoodBotOwned, #1184), as wildcards. Everything else at the
    /// top, and every file in a folder the Release sends into, goes aside.</summary>
    public static readonly string[] BotOwned =
    [
        "bot.env.json", "thornswood-deploy.json", "data", "service", "webhooks", "py-libs", "bot.log", "bot.log.*",
        "run.ps1", "roll-log.ps1",
        "heartbeat.json", "joins.json", "open-tickets.json", "commands-synced.json", "heartbeat.json.tmp", "joins.json.tmp",
    ];

    /// <summary>The bot's libraries' folder, which moves with the code when
    /// requirements.txt changed (Swap.ps1's $Dirs).</summary>
    public const string Libs = "py-libs";

    /// <summary>What the site's swap holds to the Release: the files at the
    /// top of public (its folders, such as downloads, are filled by other
    /// scripts), the public pages and the program's modules in lib (#5357).
    /// Anything there the Release does not carry goes aside (Swap.ps1's
    /// $Gone, #2572), so a module the site no longer has is not left
    /// beside the ones it loads.</summary>
    static readonly string[] SiteHeld = ["public", "data/site", "lib"];

    /// <summary>What a Release carries for voice, the files Install-Voice.ps1
    /// sends: its program, the headlines it reads, and the log writer its
    /// task runs it under. Its keys, logs and chat records are never touched.</summary>
    static readonly string[] VoiceFiles = ["voice-server.js", "headlines.js", "server-log.js"];

    /// <summary>Says once whether the app answers, for the agent's check.</summary>
    public async Task<string> Unhealthy(CancellationToken ct)
    {
        var why = control.NotInstalled(env);
        if (why != "") return why;
        if (env.Kind == AppKinds.Discord) return control.Running(env) ? "" : $"the service {env.Service} is not running";
        if (env.Kind == AppKinds.Voice) return await VoiceUnhealthy(ct);
        return await HttpUnhealthy(ct);
    }

    static readonly Regex VoiceBuild = new(@"const\s+BUILD\s*=\s*'([^']+)'");

    /// <summary>The build voice-server.js in the folder names (its const
    /// BUILD), or "" when it names none.</summary>
    public static string BuildOf(string file)
    {
        try { var m = VoiceBuild.Match(File.ReadAllText(file)); return m.Success ? m.Groups[1].Value : ""; }
        catch (IOException) { return ""; }
    }

    /// <summary>Voice answers only when /health, asked on the box, says the
    /// build of the voice-server.js in its folder: an old process still on
    /// the port answers too, so "it answers" alone proves nothing
    /// (Install-Voice.ps1, #2711). After a swap that is the new file; after a
    /// put back, the old one.</summary>
    async Task<string> VoiceUnhealthy(CancellationToken ct)
    {
        var want = BuildOf(Path.Combine(Root, "voice-server.js"));
        if (want == "") return $"{Path.Combine(Root, "voice-server.js")} names no const BUILD to check the service by";
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(5));
            using var res = await http.GetAsync(env.Health, cts.Token);
            if ((int)res.StatusCode != 200) return $"{env.Health} answered HTTP {(int)res.StatusCode}";
            var got = "";
            try
            {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("build", out var b) && b.ValueKind == JsonValueKind.String) got = b.GetString()!;
            }
            catch (JsonException) { return $"{env.Health} did not answer JSON"; }
            if (got == want) return "";
            return got == "" ? $"{env.Health} names no build" : $"{env.Health} says build {Trim(got)}, not the {Trim(want)} in the folder, so it is another copy";
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return $"{env.Health} did not answer: {e.Message}";
        }
    }

    async Task<string> HttpUnhealthy(CancellationToken ct)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(5));
            using var res = await http.GetAsync(env.Health, cts.Token);
            var code = (int)res.StatusCode;
            // Deploy-Docs.ps1's Healthy: anything under 500 is a site that
            // answers; a page that is not there is still the site saying so.
            return code > 0 && code < 500 ? "" : $"{env.Health} answered HTTP {code}";
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return $"{env.Health} did not answer: {e.Message}";
        }
    }

    /// <summary>Puts the zip in. tag names the Release, for the record and the lines.</summary>
    public async Task<Outcome> Apply(string zip, string tag, string commit, string from, Action<string> log, CancellationToken ct)
    {
        var why = control.NotInstalled(env);
        if (why != "") return new Outcome("failure", "not applied: " + why);
        if (!Directory.Exists(Root)) return new Outcome("failure", $"not applied: there is no {Root}; a full install puts the app there first");

        var stamp = Swap.FreeStamp(Root, Now());
        // Not .stage-*: Deploy-Docs.ps1 and Install-Bot.ps1 clear every
        // .stage-* they find as they start, and either may still be run by
        // the gate. Inside the root, so a file moved in carries the root's
        // permissions, which the app's account reads.
        var stageName = ".agent-stage-" + stamp;
        var prevName = ".prev-" + stamp;
        var stage = Path.Combine(Root, stageName);
        var prev = Path.Combine(Root, prevName);

        // A stage a run that died part way left was never swapped in.
        foreach (var d in Directory.EnumerateDirectories(Root, ".agent-stage-*")) TryDelete(d);

        // ---- 1. the stage, while the app runs ----
        List<string> sent;
        try { sent = Expand(zip, stage); }
        catch (Exception e) when (e is InvalidDataException or IOException or UnauthorizedAccessException)
        {
            TryDelete(stage);
            return new Outcome("failure", "not applied: " + e.Message);
        }
        var changed = new List<string>();
        foreach (var rel in sent)
        {
            var at = At(Root, rel);
            var st = At(stage, rel);
            if (File.Exists(at) && Sum(at) == Sum(st)) File.Delete(st);
            else changed.Add(rel);
        }
        var gone = env.Kind == AppKinds.Site ? Gone(sent) : [];
        var strays = env.Kind == AppKinds.Discord ? Strays(sent) : [];
        log($"{sent.Count} file(s) in the Release; {changed.Count} differ from what {Root} has" +
            (gone.Count > 0 ? $"; {gone.Count} there are no longer in it: {string.Join(", ", gone)}" : "") +
            (strays.Count > 0 ? $"; {strays.Count} there are not the app's own: {string.Join(", ", strays)}" : ""));
        var moves = new List<string>(changed);

        var bad = new List<string>();
        foreach (var rel in changed)
        {
            var st = At(stage, rel);
            if (rel.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) bad.AddRange(JsonRefusal(rel, st));
            if (rel.EndsWith(".js", StringComparison.OrdinalIgnoreCase) || rel.EndsWith(".py", StringComparison.OrdinalIgnoreCase))
            {
                if (env.Kind == AppKinds.Site && rel.StartsWith("public/", StringComparison.Ordinal)) continue;
                var said = control.Parse(env, st);
                if (said != "") bad.Add($"{rel} does not parse: {said}");
            }
        }
        if (bad.Count == 0 && env.Kind == AppKinds.Discord && changed.Contains("requirements.txt"))
        {
            log("requirements.txt changed, so the libraries go into the stage's py-libs from it, held to its hashes");
            var trustPy = File.Exists(At(stage, "trust.py")) ? At(stage, "trust.py") : At(Root, "trust.py");
            Directory.CreateDirectory(Path.Combine(stage, Libs));
            var said = control.Libraries(env, At(stage, "requirements.txt"), Path.Combine(stage, Libs), trustPy);
            if (said != "") bad.Add("the libraries did not install: " + said);
            else moves.Add(Libs);
        }
        if (bad.Count > 0)
        {
            foreach (var b in bad) log("REFUSED: " + b);
            TryDelete(stage);
            return new Outcome("failure", "not applied: " + Trim(bad[0]) + "; nothing running was touched");
        }
        if (moves.Count == 0 && gone.Count == 0 && strays.Count == 0)
        {
            TryDelete(stage);
            Record(zip, tag, commit, sent.Count, from, log);
            return new Outcome("success", $"{tag}: {Root} already has every file of it, so the {Name} was not stopped");
        }
        log($"the stage checks out: {changed.Count} file(s)" + (changed.Any(IsProgram) ? ", and the programs parse" : ""));

        // ---- 2. the stop and the swap, under a hold ----
        var hold = env.Kind == AppKinds.Discord ? env.Service : env.Task;
        Hold.Set(env.Watch, hold, $"the deploy agent is swapping in {tag}", from, Math.Max(10, (env.WaitSeconds * 3 + 120) / 60), log);
        try
        {
            var stopped = Stop(log);
            var aside = new List<string>();
            var placed = new List<string>();
            var moved = stopped;
            if (!stopped) log("what the stop ended has not all exited, so its files may still be open, and nothing was moved");
            foreach (var rel in moved ? moves : [])
            {
                var at = At(Root, rel);
                if (Exists(at))
                {
                    var m = Move(at, At(prev, rel));
                    if (m != "") { log($"could not move the old {rel} aside: {m}"); moved = false; break; }
                    aside.Add(rel);
                }
                var n = Move(At(stage, rel), at);
                if (n != "") { log($"could not move the new {rel} into place: {n}"); moved = false; break; }
                placed.Add(rel);
            }
            foreach (var rel in moved ? gone.Concat(strays) : [])
            {
                var m = Move(At(Root, rel), At(prev, rel));
                if (m != "") { log($"could not move {rel} aside: {m}"); moved = false; break; }
                aside.Add(rel);
            }

            if (moved)
            {
                log($"swapped in {placed.Count} file(s); the ones they replaced are in {prevName}" +
                    (gone.Count > 0 ? $"; took out {gone.Count} the Release no longer has" : "") +
                    (strays.Count > 0 ? $"; moved aside {strays.Count} that are not the {Name}'s own" : ""));
                var started = StartIt(log);
                var answer = started == "" ? await Healthy(log, ct) : started;
                if (answer == "")
                {
                    TryDelete(stage);
                    PruneOld(log);
                    Record(zip, tag, commit, sent.Count, from, log);
                    return new Outcome("success", $"{tag}: the {Name} runs it ({placed.Count} file(s) new) and answers", Prev: prevName);
                }
                why = answer;
                log("FAIL: " + why);
                Stop(log);
            }
            else why = "the files could not all be moved, so the old ones went back";

            // ---- 4. the way back ----
            log("putting the previous files back");
            var clean = true;
            foreach (var rel in Enumerable.Reverse(moves.Concat(gone).Concat(strays).ToList()))
            {
                var at = At(Root, rel);
                if (placed.Contains(rel))
                {
                    var m = Move(at, At(stage, rel));
                    if (m != "") { log($"COULD NOT TAKE THE NEW {rel} BACK OUT: {m}"); clean = false; continue; }
                }
                if (aside.Contains(rel))
                {
                    var m = Move(At(prev, rel), at);
                    if (m != "") { log($"COULD NOT PUT THE OLD {rel} BACK: {m}"); clean = false; }
                }
            }
            var again = StartIt(log);
            var back = again == "" ? await Healthy(log, ct) : again;
            if (back == "") log("the previous files are back and it is answering again");
            else log("THE PREVIOUS FILES ARE BACK AND IT STILL IS NOT ANSWERING: " + back);
            if (clean)
            {
                TryDelete(stage);
                TryDelete(prev);
            }
            else log($"what it replaced is still in {prevName} and what it could not take out is in {stageName}");
            if (clean && back == "") return new Outcome("failure", Trim(why) + $"; the previous {Name} is back and answering");
            var fix = env.Kind switch
            {
                AppKinds.Discord => "Install-Bot.ps1 -PutBack",
                AppKinds.Voice => $"Install-Voice.ps1 -Root {Root} -TaskName '{env.Task}' -PutBack",
                _ => "Deploy-Docs.ps1 -PutBack",
            };
            return new Outcome("error", Trim(why) + $"; putting the old one back did not take either, so the {Name} needs {fix}", Prev: prevName);
        }
        finally { Hold.Clear(env.Watch, hold, log); }
    }

    string Name => env.Kind switch { AppKinds.Discord => "Discord bot", AppKinds.Voice => "voice service", _ => env.Kind };

    static bool IsProgram(string rel) => rel.EndsWith(".js", StringComparison.OrdinalIgnoreCase) || rel.EndsWith(".py", StringComparison.OrdinalIgnoreCase);

    bool Stop(Action<string> log)
    {
        var r = control.Stop(env, TimeSpan.FromSeconds(30));
        foreach (var l in r.Lines) log(l);
        foreach (var l in r.Left) log(l);
        return r.Left.Count == 0;
    }

    string StartIt(Action<string> log)
    {
        if (env.Kind == AppKinds.Discord) MarkBotLog();
        try { control.Start(env); log($"started; giving it {env.WaitSeconds} seconds to answer"); return ""; }
        catch (ControlException e) { return "it did not start: " + e.Message; }
    }

    /// <summary>"" once it answers within WaitSeconds, or why not. The site:
    /// its front page under 500 (Deploy-Docs.ps1's Healthy). The bot: what
    /// this start wrote to its log says it is watching its server, with the
    /// service Running (Install-Bot.ps1's Healthy); a bot that says
    /// "stopped within" has failed at once.</summary>
    async Task<string> Healthy(Action<string> log, CancellationToken ct)
    {
        var until = Now().AddSeconds(env.WaitSeconds);
        if (env.Kind == AppKinds.Discord) return await BotHealthy(until, log, ct);
        var last = "";
        while (true)
        {
            last = env.Kind == AppKinds.Voice ? await VoiceUnhealthy(ct) : await HttpUnhealthy(ct);
            if (last == "") { log($"health: {env.Health} answers"); return ""; }
            if (Now() > until) return $"it did not answer within {env.WaitSeconds} seconds ({last})";
            await Task.Delay(Tick, ct);
        }
    }

    // ---- the bot's log ----

    /// <summary>The bot's log, where the running service writes it: data\bot.log,
    /// or bot.log beside the code on a box whose service program is older, the
    /// one written last when both are there (Get-ThornswoodBotLog).</summary>
    public static string BotLog(string root)
    {
        var nw = Path.Combine(root, "data", "bot.log");
        var old = Path.Combine(root, "bot.log");
        if (!File.Exists(old)) return nw;
        if (!File.Exists(nw)) return old;
        return File.GetLastWriteTimeUtc(old) > File.GetLastWriteTimeUtc(nw) ? old : nw;
    }

    long botFrom;
    string botLog = "";

    async Task<string> BotHealthy(DateTime until, Action<string> log, CancellationToken ct)
    {
        var watching = new Regex(@"watching \d+ server");
        while (true)
        {
            var said = BotSaid();
            if (said.Any(l => watching.IsMatch(l)) && control.Running(env)) { log($"the service {env.Service} is Running and the bot says it is watching its server"); return ""; }
            if (said.Any(l => l.Contains("stopped within"))) return "the bot stopped as it started: " + Trim(said.Last(l => l.Contains("stopped within")).Trim());
            if (Now() > until)
            {
                if (said.Count == 0 && control.Running(env))
                {
                    // Install-Bot.ps1's rule: a start that wrote nothing at all
                    // is a log that could not be read, not a bot that failed,
                    // and the old code never goes back over a bot that is up.
                    log($"the service {env.Service} is Running, but this start wrote nothing to {botLog}; read the bot's own lines with Show-BotLog.ps1");
                    return "";
                }
                foreach (var l in said.Where(l => l.Contains("Error") || l.Contains("Traceback") || l.TrimStart().StartsWith('[')).TakeLast(25)) log("  " + l);
                return $"the bot did not say it is watching its server within {env.WaitSeconds} seconds";
            }
            await Task.Delay(Tick, ct);
        }
    }

    /// <summary>Marks where the bot's log ends, before a start.</summary>
    void MarkBotLog()
    {
        botLog = BotLog(Root);
        botFrom = File.Exists(botLog) ? new FileInfo(botLog).Length : 0;
    }

    /// <summary>What this start wrote to the bot's log. Shorter than before means it rolled.</summary>
    List<string> BotSaid()
    {
        if (!File.Exists(botLog)) return [];
        try
        {
            using var f = Files.OpenShared(botLog);
            var from = f.Length < botFrom ? 0 : botFrom;
            if (f.Length <= from) return [];
            f.Seek(from, SeekOrigin.Begin);
            using var r = new StreamReader(f, Encoding.UTF8);
            return r.ReadToEnd().Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l != "").ToList();
        }
        catch (IOException) { return []; }
    }

    // ---- the stage ----

    /// <summary>Opens the zip into dir. Every entry is a file whose path is
    /// plain names joined by '/', so nothing in it can land outside the app's
    /// folder; the bot's own files and the site's own data are refused by
    /// name, so a Release can never overwrite what the app writes.</summary>
    public List<string> Expand(string zip, string dir)
    {
        Directory.CreateDirectory(dir);
        var full = Path.GetFullPath(dir) + Path.DirectorySeparatorChar;
        var outList = new List<string>();
        using var za = ZipFile.OpenRead(zip);
        foreach (var ze in za.Entries)
        {
            var rel = ze.FullName;
            if (rel.EndsWith('/')) throw new InvalidDataException($"the zip holds a folder entry, {rel}, and the apps' zips hold files only");
            var segs = rel.Split('/');
            if (segs.Any(s => !Segment.IsMatch(s))) throw new InvalidDataException($"the zip holds {rel}, which is not a plain path under the {Name}'s folder");
            if (!Allowed(rel)) throw new InvalidDataException($"the zip holds {rel}, which is not one of the {Name}'s files a Release may carry");
            if (outList.Contains(rel, StringComparer.OrdinalIgnoreCase)) throw new InvalidDataException($"the zip holds {rel} twice");
            // The plain names above already keep it inside; this says so of
            // the path the file is written to, as ServerBuild's expand does.
            var to = Path.GetFullPath(At(dir, rel));
            if (!to.StartsWith(full, StringComparison.Ordinal)) throw new InvalidDataException($"the zip names {rel}, which is outside the {Name}'s folder");
            Directory.CreateDirectory(Path.GetDirectoryName(to)!);
            using (var s = ze.Open())
            using (var f = new FileStream(to, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                s.CopyTo(f);
                f.Flush(true);
            }
            outList.Add(rel);
        }
        if (outList.Count == 0) throw new InvalidDataException("the zip holds no files");
        return outList;
    }

    /// <summary>What a Release may carry into this app's folder. The site: its
    /// program (server.js and its modules in lib, #5357), its public files
    /// and its public pages, never the documents,
    /// boards, uploads or anything else the site writes. The bot: its code
    /// and its card art, never anything Get-ThornswoodBotOwned names.</summary>
    bool Allowed(string rel)
    {
        if (env.Kind == AppKinds.Site)
            return rel == "server.js" || (rel.StartsWith("public/", StringComparison.Ordinal) && rel.Count(c => c == '/') == 1)
                || (rel.StartsWith("lib/", StringComparison.Ordinal) && rel.EndsWith(".js", StringComparison.Ordinal) && rel.Count(c => c == '/') == 1)
                || (rel.StartsWith("data/site/", StringComparison.Ordinal) && rel.Count(c => c == '/') == 2);
        if (env.Kind == AppKinds.Discord)
        {
            var top = rel.Split('/')[0];
            if (BotOwned.Any(o => Like(top, o))) return false;
            return rel.Count(c => c == '/') == 0 || (top == "assets" && rel.Count(c => c == '/') == 1);
        }
        if (env.Kind == AppKinds.Voice) return VoiceFiles.Contains(rel);
        return false;
    }

    /// <summary>The site's files the Release no longer has: at the top of
    /// public and among the public pages (Swap.ps1's $Gone).</summary>
    List<string> Gone(List<string> sent)
    {
        var outList = new List<string>();
        foreach (var held in SiteHeld)
        {
            var dir = At(Root, held);
            if (!Directory.Exists(dir)) continue;
            foreach (var f in Directory.EnumerateFiles(dir).Select(Path.GetFileName).OrderBy(n => n, StringComparer.Ordinal))
            {
                var rel = held + "/" + f;
                if (!Segment.IsMatch(f!)) continue;
                if (!sent.Contains(rel, StringComparer.OrdinalIgnoreCase)) outList.Add(rel);
            }
        }
        return outList;
    }

    /// <summary>What is in the bot's folder and is neither sent nor the bot's
    /// own: at the top of the folder, and every file in a folder the Release
    /// sends into (Swap.ps1's $Owns, #1184). The swap's own folders are never
    /// looked at.</summary>
    List<string> Strays(List<string> sent)
    {
        var outList = new List<string>();
        var sentDirs = sent.Where(r => r.Contains('/')).Select(r => r.Split('/')[0]).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var e in new DirectoryInfo(Root).EnumerateFileSystemInfos().OrderBy(e => e.Name, StringComparer.Ordinal))
        {
            var n = e.Name;
            if (n.StartsWith(".stage-") || n.StartsWith(".agent-stage-") || n.StartsWith(".prev-") || n.StartsWith(".undone-")) continue;
            if (BotOwned.Any(o => Like(n, o))) continue;
            if (sent.Contains(n, StringComparer.OrdinalIgnoreCase)) continue;
            if (e is DirectoryInfo d && sentDirs.Contains(n, StringComparer.OrdinalIgnoreCase))
            {
                foreach (var f in d.EnumerateFileSystemInfos().OrderBy(f => f.Name, StringComparer.Ordinal))
                {
                    var rel = n + "/" + f.Name;
                    if (!sent.Contains(rel, StringComparer.OrdinalIgnoreCase)) outList.Add(rel);
                }
                continue;
            }
            outList.Add(n);
        }
        return outList;
    }

    static bool Like(string name, string pattern) =>
        pattern.EndsWith('*') ? name.StartsWith(pattern[..^1], StringComparison.OrdinalIgnoreCase) : string.Equals(name, pattern, StringComparison.OrdinalIgnoreCase);

    /// <summary>A JSON file node will read: no byte order mark, and it parses.</summary>
    static IEnumerable<string> JsonRefusal(string rel, string path)
    {
        var b = File.ReadAllBytes(path);
        if (b.Length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF) { yield return $"{rel} starts with a byte order mark, and node will not parse it"; yield break; }
        string? why = null;
        try { using var _ = JsonDocument.Parse(b); }
        catch (JsonException e) { why = $"{rel} does not parse: {e.Message}"; }
        if (why != null) yield return why;
    }

    // ---- the record, and the files ----

    /// <summary>The record every deploy leaves (Artifact.ps1), beside the app
    /// and in the store, so the site's /api/deploys says what runs.</summary>
    void Record(string zip, string tag, string commit, int files, string from, Action<string> log)
    {
        var rec = new DeployRecord
        {
            Component = env.Kind,
            Name = tag,
            Commit = commit,
            Sha256 = Sum(zip),
            Size = new FileInfo(zip).Length,
            Files = files,
            DeployedUtc = Records.UtcNow(),
            From = from,
        };
        Records.WriteBeside(Root, env.Store, rec, log);
    }

    void PruneOld(Action<string> log)
    {
        foreach (var kind in new[] { ".prev-", ".undone-" })
        {
            foreach (var n in Directory.EnumerateDirectories(Root).Select(Path.GetFileName).Where(n => n!.StartsWith(kind))
                         .OrderByDescending(n => n, StringComparer.Ordinal).Skip(2))
            {
                try { Directory.Delete(Path.Combine(Root, n!), true); }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log($"PRUNE FAILED: could not remove {n}, one of the old copies past the newest 2: {e.Message}"); }
            }
        }
    }

    static string At(string root, string rel) => Path.Combine([root, .. rel.Split('/')]);
    static bool Exists(string p) => File.Exists(p) || Directory.Exists(p);
    static string Sum(string p) => Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(p)));

    /// <summary>One rename, after the stop has waited for what it ended to exit
    /// (StopAndMove.ps1's Move-ThornswoodPath): "" when it moved, or why not.</summary>
    static string Move(string from, string to)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(to)!);
            if (Directory.Exists(from)) Directory.Move(from, to);
            else File.Move(from, to);
            return "";
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return e.Message; }
    }

    static void TryDelete(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    static string Trim(string s) => s.Length > 110 ? s[..107] + "..." : s;
}

/// <summary>The stamp a swap names its folders by.</summary>
public static class Swap
{
    /// <summary>now to the second, with -2, -3 and on after it when a folder
    /// of that stamp is already in root: two swaps in one second (a
    /// Deployment, then a rollback by tag) would otherwise move the second's
    /// old files into the first's .prev- folder, find them there and put
    /// everything back. The suffix sorts after the bare stamp, so the newest
    /// is still the last by name.</summary>
    public static string FreeStamp(string root, DateTime now)
    {
        var bare = now.ToString("yyyyMMdd-HHmmss");
        for (var n = 1; ; n++)
        {
            var s = n == 1 ? bare : $"{bare}-{n}";
            if (!new[] { ".prev-", ".undone-", ".agent-stage-" }.Any(k => Directory.Exists(Path.Combine(root, k + s)))) return s;
        }
    }
}
