#nullable enable
using System.Text.Json;

namespace Thornswood.DeployAgent;

/// <summary>What the agent leaves for the Discord bot before it stops a game
/// server (#5784): the restart's id, its state, when the server goes down and
/// why, in &lt;store&gt;\for-bot\restart-&lt;environment&gt;.json, the folder
/// the release news uses (News.cs). The bot posts each id's "coming" in
/// #updates (dev's in the dev updates channel) and its "back" or "down" when
/// that follows; bot\bot_restarts.py reads it.
///
/// Until 11 Nov 2026 nothing that restarted a game server said so in
/// Discord: build-1.3.20's Main Deployment swapped the live server build at
/// 11:12 AM with no word anywhere, not even in the game.
///
/// States: "coming" (written before the wait that leads to the stop), "back"
/// (the server answers again, on the new build or the old one put back) and
/// "down" (it does not answer, which the watchdog then takes up with staff),
/// or "off" (called off before the stop: the server never went down).
/// A "coming" that cannot be written refuses the swap before anything stops
/// (Server.ApplyServerBuild), the way Deploy-Server.ps1 refuses when its
/// warning in the game does not go out: a planned restart nobody was told
/// about is the fault this exists for.</summary>
public static class RestartNotice
{
    public const string Coming = "coming";
    public const string Back = "back";
    public const string Down = "down";
    public const string Off = "off";

    public static string FileFor(string store, string env) => Path.Combine(store, News.Folder, $"restart-{env}.json");

    /// <summary>Writes the notice whole. "" when it was written, otherwise why
    /// not. logOut says the restart puts people out of the game (the whole
    /// machine restarts), so the bot tells them to log out rather than that
    /// the world only freezes.</summary>
    public static string Write(string store, string env, string id, string state, DateTime downUtc, string why, Action<string> log, bool logOut = false)
    {
        var dir = Path.Combine(store, News.Folder);
        if (store == "" || !Directory.Exists(dir))
        {
            var no = $"there is no {dir}, which Install-DeployAgent.ps1 makes where the Discord bot runs";
            log($"THE RESTART NOTICE {id} ({state}) WAS NOT LEFT FOR THE BOT: {no}");
            return no;
        }
        var doc = new Dictionary<string, string>
        {
            ["environment"] = env,
            ["id"] = id,
            ["state"] = state,
            ["downUtc"] = downUtc.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"),
            ["why"] = why,
            ["writtenUtc"] = Records.UtcNow(),
        };
        if (logOut) doc["logOut"] = "yes";
        var file = FileFor(store, env);
        try
        {
            Files.WriteWhole(file, JsonSerializer.SerializeToUtf8Bytes(doc));
            log($"restart notice {id} ({state}) left for the bot in {file}");
            return "";
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            var no = $"{file} could not be written ({e.Message})";
            log($"THE RESTART NOTICE {id} ({state}) WAS NOT LEFT FOR THE BOT: {no}");
            return no;
        }
    }

    /// <summary>The notice as it stands for this environment, or null when
    /// there is none or it does not read as one.</summary>
    public static Said? Read(string store, string env)
    {
        try
        {
            using var d = JsonDocument.Parse(File.ReadAllBytes(FileFor(store, env)));
            var r = d.RootElement;
            string S(string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
            if (S("id") == "" || !DateTime.TryParseExact(S("downUtc"), "yyyy-MM-ddTHH:mm:ssZ", System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var down)) return null;
            return new Said(S("id"), S("state"), down, S("why"));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) { return null; }
    }

    public sealed record Said(string Id, string State, DateTime DownUtc, string Why);
}
