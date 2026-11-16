#nullable enable
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;

namespace Thornswood.DeployAgent;

/// <summary>The box's own restart for Windows updates, said in Discord and
/// in the game before it comes (#5784).
///
/// On 11 Nov 2026 Windows installed KB5131090 at 4:00 AM, as vps-harden.ps1
/// sets it to, and restarted the box at 4:20:57 AM with both game servers on
/// it; nobody was told. Measured on the box: at 4:05:57 AM SYSTEM set the
/// time trigger of the scheduled task \Microsoft\Windows\UpdateOrchestrator\
/// Reboot_AC to 4:20:57 AM (Task Scheduler event 140), and the task fired on
/// that trigger (event 107). So the restart is known about 15 minutes ahead,
/// in Reboot_AC's own trigger, which is the one place Windows keeps when it
/// will restart for an update.
///
/// Each pass reads that trigger. Once a restart set there is within Lead,
/// each game server gets a "coming" notice for the bot (RestartNotice, id
/// windows-&lt;environment&gt;-&lt;time&gt;, with logOut: the whole machine
/// restarts, so people are put out) and, while it runs, a countdown in the
/// game in the gamemode's restart mode ("log out somewhere safe"). After the
/// box is back, the next passes say "back" once the server answers its health
/// address, or "down" when it has not within DownAfter of the start. A
/// restart Windows moves or drops is said "off"; one that is moved is then
/// said again at its new time.
///
/// Another restart already coming for a server (a swap or a hand restart,
/// which share the notice file) is left to finish first: the Windows one is
/// said on the pass after it ends, so neither notice overwrites the other.</summary>
public sealed class WindowsRestart(IReadOnlyDictionary<string, Server> servers, Action<string> log)
{
    public const string Prefix = "windows-";
    public const string Why = "Windows updates";

    /// <summary>How far ahead a restart is said: the 15 minutes the install's
    /// timer gives (vps-harden.ps1, AlwaysAutoRebootAtScheduledTimeMinutes)
    /// fit inside it, and a restart Windows sets for the next night is not
    /// said a day early.</summary>
    public static readonly TimeSpan Lead = TimeSpan.FromMinutes(30);

    /// <summary>How long after the box starts a server may take to answer
    /// before its restart is said to have left it down.</summary>
    public static readonly TimeSpan DownAfter = TimeSpan.FromMinutes(15);

    /// <summary>A restart that never came: the box has been up since before
    /// its time, and this long has gone past it.</summary>
    public static readonly TimeSpan NeverCame = TimeSpan.FromMinutes(10);

    /// <summary>When Windows will restart the box for an update, in UTC, or
    /// null when it has none set. A test puts its own in.</summary>
    public Func<CancellationToken, Task<DateTime?>> Planned { get; set; } = ReadRebootTask;
    public Func<DateTime> UtcNow { get; set; } = () => DateTime.UtcNow;
    /// <summary>When the box last started, in UTC.</summary>
    public Func<DateTime> BootUtc { get; set; } = () => DateTime.UtcNow - TimeSpan.FromMilliseconds(System.Environment.TickCount64);

    readonly HashSet<string> said = [];

    void Once(string what)
    {
        if (said.Add(what)) log(what);
    }

    public async Task Pass(CancellationToken ct)
    {
        DateTime? planned;
        try { planned = await Planned(ct); }
        catch (Exception e) when (e is IOException or InvalidOperationException or System.ComponentModel.Win32Exception or System.Xml.XmlException or FormatException)
        {
            Once("windows restart: Reboot_AC could not be read, so a Windows restart is not said ahead: " + e.Message);
            return;
        }
        var now = UtcNow();
        // To the second, as a notice keeps it, so a restart said is known again.
        if (planned is { } exact) planned = new DateTime(exact.Ticks - exact.Ticks % TimeSpan.TicksPerSecond, DateTimeKind.Utc);
        foreach (var server in servers.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => kv.Value))
        {
            var which = server.Env.GitHubEnvironment.ToLowerInvariant();
            var store = server.Env.Store;
            var stands = RestartNotice.Read(store, which);
            var ours = stands is { State: RestartNotice.Coming } && stands.Id.StartsWith(Prefix, StringComparison.Ordinal) ? stands : null;
            var soon = planned is { } p && p > now && p - now <= Lead ? planned : null;

            if (ours != null)
            {
                if (ours.DownUtc <= now)
                {
                    await End(server, which, ours, now, ct);
                    continue;
                }
                if (soon == ours.DownUtc) continue;
                // Windows moved it or dropped it before its time.
                RestartNotice.Write(store, which, ours.Id, RestartNotice.Off, ours.DownUtc, ours.Why, log);
                stands = null;
            }

            if (soon is not { } at) continue;
            // One whose time is long gone was left by a script that did not
            // finish, and is not waited on.
            if (stands is { State: RestartNotice.Coming } && stands.DownUtc > now - Lead)
            {
                Once($"windows restart: {which} has restart {stands.Id} coming, so the Windows restart at {at:HH:mm:ss} UTC is said once that one ends");
                continue;
            }
            var id = $"{Prefix}{which}-{at:yyyyMMdd-HHmmss}";
            if (RestartNotice.Write(store, which, id, RestartNotice.Coming, at, Why, log, logOut: true) != "") continue;
            log($"windows restart: {which} goes down with the box at {at:HH:mm:ss} UTC; said in Discord");
            await TellTheGame(server, which, at - now, ct);
        }
    }

    /// <summary>After the restart's time: "back" once the box has started
    /// since and the server answers, "down" when it has not answered within
    /// DownAfter of the start, "off" when the box never restarted.</summary>
    async Task End(Server server, string which, RestartNotice.Said ours, DateTime now, CancellationToken ct)
    {
        var boot = BootUtc();
        if (boot < ours.DownUtc - TimeSpan.FromMinutes(2))
        {
            if (now - ours.DownUtc >= NeverCame)
            {
                log($"windows restart: the box has been up since {boot:HH:mm:ss} UTC, before {ours.Id}'s time, so it did not come");
                RestartNotice.Write(server.Env.Store, which, ours.Id, RestartNotice.Off, ours.DownUtc, ours.Why, log);
            }
            return;
        }
        var sick = await server.Unhealthy(ct);
        if (sick == "")
        {
            RestartNotice.Write(server.Env.Store, which, ours.Id, RestartNotice.Back, ours.DownUtc, ours.Why, log);
            return;
        }
        if (now - boot >= DownAfter)
        {
            log($"windows restart: {which} has not answered in the {(int)DownAfter.TotalMinutes} minutes since the box started: {sick}");
            RestartNotice.Write(server.Env.Store, which, ours.Id, RestartNotice.Down, ours.DownUtc, ours.Why, log);
        }
    }

    /// <summary>The countdown in the game: Request-Restart.ps1's restart mode,
    /// which tells people to log out somewhere safe and puts out whoever is
    /// still on when it ends. Only into a server that answers: one that is not
    /// running would count down on its own the next time it starts.</summary>
    async Task TellTheGame(Server server, string which, TimeSpan ahead, CancellationToken ct)
    {
        if (await server.Unhealthy(ct) is { Length: > 0 } sick)
        {
            log($"windows restart: {which} is not running ({sick}), so nobody is on it to count down for");
            return;
        }
        var rq = Path.Combine(server.DataDir(), "restart.json");
        try
        {
            Files.WriteWhole(rq, JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object>
            {
                ["seconds"] = Math.Max(0, (int)Math.Round(ahead.TotalSeconds)),
                ["mode"] = "restart",
                ["why"] = Why,
            }));
            log($"windows restart: the countdown is in {which}'s game");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log($"windows restart: THE GAME ON {which} WAS NOT TOLD: {rq} could not be written ({e.Message})");
        }
    }

    public const string RebootTask = @"\Microsoft\Windows\UpdateOrchestrator\Reboot_AC";

    /// <summary>Reboot_AC's time, from schtasks /query /xml, the task as Task
    /// Scheduler holds it. Null off Windows, when there is no such task, when
    /// it or its time trigger is off, or when it has no time.</summary>
    static async Task<DateTime?> ReadRebootTask(CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows()) return null;
        var psi = new ProcessStartInfo(Path.Combine(System.Environment.SystemDirectory, "schtasks.exe"))
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
        };
        foreach (var a in new[] { "/query", "/tn", RebootTask, "/xml" }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("schtasks did not start");
        var outText = p.StandardOutput.ReadToEndAsync(ct);
        var errText = p.StandardError.ReadToEndAsync(ct);
        await p.WaitForExitAsync(ct);
        var xml = await outText;
        if (p.ExitCode != 0)
        {
            // No such task: Windows has no restart for an update set.
            if (xml.Trim() == "") return null;
            throw new InvalidOperationException($"schtasks ended {p.ExitCode}: {(await errText).Trim()}");
        }
        return RebootTime(xml);
    }

    /// <summary>The time a task's XML says it runs, in UTC: its first time
    /// trigger that is on, when the task is on. Null otherwise.</summary>
    public static DateTime? RebootTime(string xml)
    {
        var doc = XDocument.Parse(xml.Trim().TrimStart('﻿'));
        XNamespace ns = doc.Root?.Name.Namespace ?? XNamespace.None;
        static bool On(XElement? e) => e?.Element(e.Name.Namespace + "Enabled") is not { } en || !string.Equals(en.Value.Trim(), "false", StringComparison.OrdinalIgnoreCase);
        if (!On(doc.Root?.Element(ns + "Settings"))) return null;
        foreach (var t in doc.Descendants(ns + "TimeTrigger"))
        {
            if (!On(t)) continue;
            var start = t.Element(ns + "StartBoundary")?.Value.Trim();
            if (string.IsNullOrEmpty(start)) continue;
            return DateTimeOffset.Parse(start, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeLocal).UtcDateTime;
        }
        return null;
    }
}
