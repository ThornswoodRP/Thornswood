#nullable enable
// The box deploy agent (#5180): a Windows service on the box that asks
// GitHub, on its own, whether a Deployment is waiting for a server it looks
// after, applies that Deployment's signed Release, checks the server is
// healthy, and says how it went on the Deployment. It only ever calls out.
//
// This first slice looks after the dev server only. It applies the gamemode
// by the reload Deploy-DevGamemode.ps1 already uses (Reload.ps1, #3196), and
// a new server build (an engine pin) by a stop, swap and start under a hold,
// the way Swap.ps1 does (#5219). The same code also deploys one Release by its tag for the deploy
// gate's Deploy-Release verb, which comes first (Patrick, 31 Oct 2026).
// docs/DEPLOY-AGENT.md has the whole design.
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Thornswood.DeployAgent;

/// <summary>agent.json in the agent's home folder. The installer writes it
/// (scripts/deploy/Install-DeployAgent.ps1) with the repository the box's
/// checkout came from, so no account name is built in (the repositories move
/// to an organization, #5184).</summary>
public sealed class Config
{
    /// <summary>owner/name of the repository whose Deployments and Releases are read.</summary>
    [JsonPropertyName("repo")] public string Repo { get; set; } = "";
    /// <summary>GitHub's REST address. A test points it at a stand-in.</summary>
    [JsonPropertyName("api")] public string Api { get; set; } = "https://api.github.com";
    /// <summary>The box admin App's state folder (app.json, key.pem; scripts/vps/admin/admin.js).</summary>
    [JsonPropertyName("adminState")] public string AdminState { get; set; } = @"C:\Thornswood-Admin\state";
    /// <summary>The agent's own folder: the program, agent.json, logs, work and state.</summary>
    [JsonPropertyName("home")] public string Home { get; set; } = @"C:\Thornswood-Agent";
    [JsonPropertyName("pollSeconds")] public int PollSeconds { get; set; } = 60;
    [JsonPropertyName("updateMinutes")] public int UpdateMinutes { get; set; } = 15;
    [JsonPropertyName("environments")] public Dictionary<string, EnvConfig> Environments { get; set; } = new();

    public static EnvConfig DefaultDev() => new()
    {
        GitHubEnvironment = "Dev",
        Root = @"C:\Thornswood-Server-Dev",
        Turn = @"C:\Thornswood-Backup",
        Store = @"C:\Thornswood-Deploys",
        Health = "http://127.0.0.1:7788/api/servers/thornswood/manifest.json",
        // Written by the installer from scripts/vps/vps.json, the one place
        // the box's address lives; "" leaves a Deployment without a log link.
        LogBase = "",
        LoadSeconds = 300,
        TurnSeconds = 1200,
        LivePort = 7777,
        Task = "Thornswood Dev Server",
        Watch = @"C:\Thornswood-Watch",
        // ServerReadyWait.ps1: the slower of the measured starts (dev, 113 s)
        // and half again, the wait every swap gives a started server (#1938).
        StartSeconds = 170,
    };

    /// <summary>The site (#5190): one app on the box, run by the scheduled task
    /// Deploy-Docs.ps1 sets up, answering on loopback port 3001 behind Caddy.
    /// A merge that changes it makes a Deployment to "Site".</summary>
    public static EnvConfig DefaultSite() => new()
    {
        Kind = AppKinds.Site,
        GitHubEnvironment = "Site",
        Root = @"C:\Thornswood-Docs",
        Store = @"C:\Thornswood-Deploys",
        Task = "Thornswood Docs",
        Health = "http://127.0.0.1:3001/",
        Watch = @"C:\Thornswood-Watch",
        // Deploy-Docs.ps1's -Wait.
        WaitSeconds = 30,
    };

    /// <summary>The Discord bot (#5187): the Windows service ThornswoodBot that
    /// Install-Bot.ps1 sets up. A merge that changes it makes a Deployment to
    /// "Discord bot".</summary>
    public static EnvConfig DefaultDiscord() => new()
    {
        Kind = AppKinds.Discord,
        GitHubEnvironment = "Discord bot",
        Root = @"C:\Thornswood-Bot",
        Store = @"C:\Thornswood-Deploys",
        Service = "ThornswoodBot",
        Watch = @"C:\Thornswood-Watch",
        // Install-Bot.ps1's -Wait: connecting to Discord and reading the roles takes a while.
        WaitSeconds = 90,
    };

    /// <summary>Dev voice (#5187): the task Install-Voice.ps1 registers for
    /// C:\Thornswood-Voice-Dev, answering on loopback port 7789 behind
    /// Caddy's /voice-dev. It goes in with dev's Deployment when the Release
    /// carries a voice part.</summary>
    public static EnvConfig DefaultDevVoice() => new()
    {
        Kind = AppKinds.Voice,
        Root = @"C:\Thornswood-Voice-Dev",
        Store = @"C:\Thornswood-Deploys",
        Task = "Thornswood Dev Voice",
        Health = "http://127.0.0.1:7789/health",
        Watch = @"C:\Thornswood-Watch",
        // Install-Voice.ps1's -Wait.
        WaitSeconds = 30,
    };

    /// <summary>The environment a name in agent.json starts from.</summary>
    public static EnvConfig DefaultFor(string name) => name switch
    {
        "dev" => DefaultDev(),
        AppKinds.Site => DefaultSite(),
        AppKinds.Discord => DefaultDiscord(),
        "main" => DefaultMain(),
        _ => new EnvConfig(),
    };

    /// <summary>The live server (#5181). It takes only a Release dev ran, and
    /// only once Patrick has approved its Deployment on GitHub
    /// (promote-main.yml); no bot pass, which ran on dev.</summary>
    public static EnvConfig DefaultMain() => new()
    {
        GitHubEnvironment = "Main",
        Root = @"C:\Thornswood-Server",
        Turn = @"C:\Thornswood-Backup",
        Store = @"C:\Thornswood-Deploys",
        Health = "http://127.0.0.1:3000/api/servers/thornswood/manifest.json",
        LogBase = "",
        LoadSeconds = 300,
        TurnSeconds = 1200,
        RequirePort = 7777,
        Task = "Thornswood Server",
        Watch = @"C:\Thornswood-Watch",
        StartSeconds = 170,
        Approved = true,
    };

    static readonly Regex RepoShape = new(@"^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$");

    /// <summary>Reads agent.json. Each environment it names starts from that
    /// environment's default, so the file can change one field of dev.</summary>
    public static Config Load(string path)
    {
        var c = new Config();
        using (var doc = JsonDocument.Parse(File.ReadAllText(path)))
        {
            var root = doc.RootElement;
            string Str(string name, string dflt) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : dflt;
            int Int(string name, int dflt) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : dflt;
            c.Repo = Str("repo", c.Repo);
            c.Api = Str("api", c.Api);
            c.AdminState = Str("adminState", c.AdminState);
            c.Home = Str("home", c.Home);
            c.PollSeconds = Int("pollSeconds", c.PollSeconds);
            c.UpdateMinutes = Int("updateMinutes", c.UpdateMinutes);
            if (root.TryGetProperty("environments", out var envs) && envs.ValueKind == JsonValueKind.Object)
            {
                foreach (var e in envs.EnumerateObject())
                {
                    c.Environments[e.Name] = DefaultFor(e.Name).Overlay(e.Value);
                }
            }
            else
            {
                c.Environments["dev"] = DefaultDev();
            }
        }
        c.Validate();
        return c;
    }

    /// <summary>Refuses a config this slice cannot run safely.</summary>
    public void Validate()
    {
        if (!RepoShape.IsMatch(Repo)) throw new ConfigException($"repo \"{Repo}\" is not owner/name");
        if (!Api.StartsWith("https://") && !Api.StartsWith("http://127.0.0.1")) throw new ConfigException($"api \"{Api}\" is not https (only a stand-in on 127.0.0.1 may be plain http)");
        if (PollSeconds < 15) throw new ConfigException($"pollSeconds {PollSeconds} is under 15");
        if (UpdateMinutes < 1) throw new ConfigException($"updateMinutes {UpdateMinutes} is under 1");
        if (Home == "" || AdminState == "") throw new ConfigException("home and adminState must be named");
        if (Environments.Count == 0) throw new ConfigException("no environment is named, so there is nothing to look after");
        foreach (var (name, e) in Environments)
        {
            // Dev, the site, the Discord bot, and the live server once Patrick
            // approves (#5181).
            if (name is not ("dev" or "main" or AppKinds.Site or AppKinds.Discord)) throw new ConfigException($"environment \"{name}\": this agent applies dev, main, site and discord only so far (#5180, #5181, #5190, #5187)");
            if (name != "main" && e.GitHubEnvironment is "" or "Main")
                throw new ConfigException($"environment {name}: githubEnvironment \"{e.GitHubEnvironment}\" must be named, and not Main, whose Deployments wait on Patrick's approval (#5181)");
            if (name == "main")
            {
                // Main is the one environment whose Deployments the agent
                // holds to an approval, so none of that can be written away.
                if (e.GitHubEnvironment != "Main" || !e.Approved || e.Kind != EnvConfig.ServerKind) throw new ConfigException("environment main: it applies the Main environment's Deployments to the live server, each held to Patrick's approval, and agent.json cannot change that");
                if (e.RequirePort == 0 || e.LivePort != 0) throw new ConfigException("environment main: it must name the live server's port (requirePort) and refuses none (livePort)");
                if (e.BotPassRoot != "") throw new ConfigException("environment main: no bot pass; the Release passed one on dev");
            }
            else if (e.Approved) throw new ConfigException($"environment {name}: only main is held to an approval");
            if (e.Root == "" || !(Path.IsPathRooted(e.Root) || e.Root.Contains(@":\"))) throw new ConfigException($"environment {name}: root \"{e.Root}\" is not a full path");
            if (e.Kind != EnvConfig.ServerKind)
            {
                if (e.Kind == AppKinds.Site && (e.Health == "" || e.Task == "")) throw new ConfigException($"environment {name}: the site needs its health address and its task");
                if (e.Kind == AppKinds.Site && !Uri.TryCreate(e.Health, UriKind.Absolute, out _)) throw new ConfigException($"environment {name}: health \"{e.Health}\" is not an address");
                if (e.Kind == AppKinds.Discord && e.Service == "") throw new ConfigException($"environment {name}: the bot needs its service's name");
                if (e.WaitSeconds < 10) throw new ConfigException($"environment {name}: waitSeconds must be 10 or more");
                if (e.LogDir != "" && !(Path.IsPathRooted(e.LogDir) || e.LogDir.Contains(@":\"))) throw new ConfigException($"environment {name}: logDir \"{e.LogDir}\" is not a full path");
                continue;
            }
            if (e.Health == "") throw new ConfigException($"environment {name}: no health address");
            if (e.Voice is { } v)
            {
                if (v.Root == "" || !(Path.IsPathRooted(v.Root) || v.Root.Contains(@":\"))) throw new ConfigException($"environment {name}: voice root \"{v.Root}\" is not a full path");
                if (v.Task == "" || !Uri.TryCreate(v.Health, UriKind.Absolute, out _)) throw new ConfigException($"environment {name}: voice needs its task and its health address");
                if (v.WaitSeconds < 10) throw new ConfigException($"environment {name}: voice waitSeconds must be 10 or more");
            }
            if (e.LoadSeconds < 10 || e.TurnSeconds < 10 || e.StartSeconds < 10) throw new ConfigException($"environment {name}: loadSeconds, turnSeconds and startSeconds must be 10 or more");
            if (e.BotPassRoot != "")
            {
                if (!(Path.IsPathRooted(e.BotPassRoot) || e.BotPassRoot.Contains(@":\"))) throw new ConfigException($"environment {name}: botPassRoot \"{e.BotPassRoot}\" is not a full path");
                if (string.Equals(e.BotPassRoot.TrimEnd('\\', '/'), e.Root.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
                    throw new ConfigException($"environment {name}: botPassRoot is the server's own folder, and the bot pass is a throwaway copy");
                if (e.BotPassTask == "") throw new ConfigException($"environment {name}: a bot pass needs botPassTask");
                if (e.BotPassSeconds < 60) throw new ConfigException($"environment {name}: botPassSeconds must be 60 or more");
            }
        }
        if (Environments.TryGetValue("dev", out var d) && Environments.TryGetValue("main", out var mn) &&
            string.Equals(d.Root.TrimEnd('\\', '/'), mn.Root.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
            throw new ConfigException("dev and main name the same server folder");
    }
}

/// <summary>One server, or one app beside them, the agent looks after.</summary>
public sealed class EnvConfig
{
    public const string ServerKind = "server";
    /// <summary>What it is: a game server ("server"), the site ("site") or
    /// the Discord bot ("discord"). Set by the environment's name; agent.json
    /// does not change it.</summary>
    public string Kind { get; set; } = ServerKind;
    /// <summary>A server's voice service, which goes in with its Deployments
    /// (#5187). null when agent.json names none for it.</summary>
    public EnvConfig? Voice { get; set; }
    /// <summary>The Windows service an app runs as (the bot's ThornswoodBot).</summary>
    public string Service { get; set; } = "";
    /// <summary>How long a started app has to answer before its old files go back.</summary>
    public int WaitSeconds { get; set; } = 30;
    /// <summary>Where an app's Deployment logs go, with LogBase the address
    /// they are read at. Install-DeployAgent.ps1 points it at the dev server's
    /// data folder, the one folder on the box served to the outside. "" keeps
    /// them in the agent's own log only.</summary>
    public string LogDir { get; set; } = "";
    /// <summary>The Deployment environment applied for this server: Dev, where
    /// the merge release (.github/workflows/merge-release.yml, #5179) makes a
    /// Deployment for each Release whose parts changed. Deployments the old
    /// Record-Deployment.ps1 wrote there already carry a success, so they are
    /// never applied again.</summary>
    public string GitHubEnvironment { get; set; } = "";
    /// <summary>The game server's folder.</summary>
    public string Root { get; set; } = "";
    /// <summary>The folder holding server-folders.turn (#3247).</summary>
    public string Turn { get; set; } = "";
    /// <summary>The deploy record store (scripts/deploy/Artifact.ps1): current\&lt;part&gt;.json and history.log.</summary>
    public string Store { get; set; } = "";
    /// <summary>Asked over HTTP before and after a load; 200 is healthy (the watchdog's address).</summary>
    public string Health { get; set; } = "";
    /// <summary>Where the outside world reads the server's data folder, for a Deployment's log_url.</summary>
    public string LogBase { get; set; } = "";
    public int LoadSeconds { get; set; }
    public int TurnSeconds { get; set; }
    /// <summary>The live server's port: a root whose settings name it is refused.</summary>
    public int LivePort { get; set; }
    /// <summary>The port this server's settings must name, so a main pointed at
    /// another folder is refused (#5181). 0 asks for none.</summary>
    public int RequirePort { get; set; }
    /// <summary>Each Deployment is held to Patrick's approval of the
    /// promote-main.yml run that made it (#5181). Set by DefaultMain only,
    /// never read from agent.json.</summary>
    public bool Approved { get; set; }
    /// <summary>The bot pass's folder (#5196, BotPass.cs). "" until
    /// Install-DeployAgent.ps1 has registered its task and made the folder;
    /// from then on every Deployment waits on a bot pass.</summary>
    public string BotPassRoot { get; set; } = "";
    /// <summary>The scheduled task that runs the bot pass in that folder.</summary>
    public string BotPassTask { get; set; } = "Thornswood Bot Pass";
    /// <summary>How long a bot pass may run before it is stopped and fails.</summary>
    public int BotPassSeconds { get; set; } = 1800;
    /// <summary>The server's scheduled task, which a server build swap stops
    /// and starts (Install-ThornswoodServer.ps1 registers it). "" refuses
    /// every swap, so only a gamemode reload is done.</summary>
    public string Task { get; set; } = "";
    /// <summary>The watchdog's folder, whose holds\ a swap writes its hold in
    /// (#5155, ServerHold.ps1). "" when no watchdog runs.</summary>
    public string Watch { get; set; } = "";
    /// <summary>How long a started server has to answer on both its ports
    /// before a swap puts the old build back.</summary>
    public int StartSeconds { get; set; } = 170;

    internal EnvConfig Overlay(JsonElement e)
    {
        string S(string n, string d) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : d;
        int I(string n, int d) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : d;
        GitHubEnvironment = S("githubEnvironment", GitHubEnvironment);
        Root = S("root", Root);
        Turn = S("turn", Turn);
        Store = S("store", Store);
        Health = S("health", Health);
        LogBase = S("logBase", LogBase);
        LoadSeconds = I("loadSeconds", LoadSeconds);
        TurnSeconds = I("turnSeconds", TurnSeconds);
        LivePort = I("livePort", LivePort);
        RequirePort = I("requirePort", RequirePort);
        BotPassRoot = S("botPassRoot", BotPassRoot);
        BotPassTask = S("botPassTask", BotPassTask);
        BotPassSeconds = I("botPassSeconds", BotPassSeconds);
        Task = S("task", Task);
        Watch = S("watch", Watch);
        StartSeconds = I("startSeconds", StartSeconds);
        Service = S("service", Service);
        WaitSeconds = I("waitSeconds", WaitSeconds);
        LogDir = S("logDir", LogDir);
        if (e.TryGetProperty("voice", out var vo) && vo.ValueKind == JsonValueKind.Object)
        {
            var v = (Voice ?? Config.DefaultDevVoice()).Overlay(vo);
            v.Store = Store;
            v.Watch = Watch;
            Voice = v;
        }
        return this;
    }
}

public sealed class ConfigException(string message) : Exception(message);
