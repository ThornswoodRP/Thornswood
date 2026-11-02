#nullable enable
using System.Text.Json;

namespace Thornswood.DeployAgent;

/// <summary>What a Deployment that went in leaves for the Discord bot, which
/// posts the release's news from it (#5187): the Release's tag, name, notes
/// and page, in &lt;store&gt;\for-bot\news-&lt;environment&gt;.json, newest
/// only. The bot keeps which tags it said, so the same Release reaching dev,
/// the site and the bot is one post. Written only after the Deployment's
/// success is on GitHub, and never for a rollback by tag, which is not news.
/// The folder is Install-DeployAgent.ps1's: SYSTEM and Administrators Full,
/// NT SERVICE\ThornswoodBot Read and nothing else, so the bot reads it and
/// nothing on the box but the agent writes it. With no folder there is no
/// bot to tell, and the log says so.</summary>
public static class News
{
    public const string Folder = "for-bot";

    public static string FileFor(string store, string env) => Path.Combine(store, Folder, $"news-{env}.json");

    public static void Write(string store, string env, Release rel, string commit, Action<string> log)
    {
        var dir = Path.Combine(store, Folder);
        if (store == "" || !Directory.Exists(dir))
        {
            log($"no news left for the bot: there is no {dir}, which Install-DeployAgent.ps1 makes");
            return;
        }
        var doc = new Dictionary<string, string>
        {
            ["environment"] = env,
            ["tag"] = rel.TagName,
            ["name"] = rel.Name,
            ["body"] = rel.Body,
            ["url"] = rel.HtmlUrl,
            ["commit"] = commit,
            ["deployedUtc"] = Records.UtcNow(),
        };
        var file = FileFor(store, env);
        try
        {
            Files.WriteWhole(file, JsonSerializer.SerializeToUtf8Bytes(doc));
            log($"the news of {rel.TagName} is left for the bot in {file}");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log($"THE NEWS OF {rel.TagName} WAS NOT LEFT FOR THE BOT: {file} could not be written ({e.Message})");
        }
    }
}
