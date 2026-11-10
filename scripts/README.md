# The PowerShell scripts

Every `.ps1` under this folder, by area: `release` builds and
ships, `deploy` puts things on the VPS, `vps` looks after the box, `ops` runs
the world day to day, `mods` works on the collection and the plugins, `dev`
is for whoever is changing this repository. `oneoff` holds finished one time
scripts and has its own README. Each row is the one line that says
what each one is for. New-ScriptIndex.ps1 writes this file from the scripts
themselves: the line is a script's .SYNOPSIS where it has one, and otherwise
the first sentence of the comment at its top. Do not edit it by hand. Change
the script, then run

    .\scripts\dev\New-ScriptIndex.ps1

and commit this file with it. tests\test-script-index.ps1, which the nightly
checks run, fails when this file is not what that would write.

A script's options are not listed here. Get-Help reads them off its param
block, so they are always all of them:

    Get-Help .\scripts\release\Ship.ps1 -Full

The node and Python scripts beside these (`Build-*.js`, `Audit-*.py` and the
rest) and the `test-*.js` harnesses are not in this list.

| Script | What it is for |
| --- | --- |
| [bot/Load-Box.ps1](bot/Load-Box.ps1) | #4623. The load test with the collection's world: its NPCs, the gamemode's NPC runtime, merchants and quests, and bots that fight, host the NPCs near them and ask the guild traders to trade. |
| [deploy/Artifact.ps1](deploy/Artifact.ps1) | What a deploy sends, built from a commit rather than copied off a working tree, and what the box keeps to say which commit each part runs. |
| [deploy/Bot-Code.ps1](deploy/Bot-Code.ps1) | The Discord bot's code as one list (#5357): what Install-Bot.ps1 sends and parse checks on the box, and what App-Part.ps1 puts in the bot's part of a Release for the deploy agent. |
| [deploy/Check-GitHubSettings.ps1](deploy/Check-GitHubSettings.ps1) | Reads GitHub's Actions settings, environments, secrets and variables for this repository and names every way they differ from records\github-settings.json on main. |
| [deploy/CloudflareRanges.ps1](deploy/CloudflareRanges.ps1) | Dot-sourced. Reads scripts\deploy\cloudflare-ranges.txt, the addresses Cloudflare's proxy reaches the box from, and says whether an address is inside them (#2995). |
| [deploy/CollectionPlugins.ps1](deploy/CollectionPlugins.ps1) | Holds the plugins a deploy sends to the collection's own bytes (#2019). |
| [deploy/CollectionStore.ps1](deploy/CollectionStore.ps1) | The collection's plugins on the box, for the revision the repository records, so a server can move to a new collection revision with nothing of One's (#4069). |
| [deploy/Deploy-DevGamemode.ps1](deploy/Deploy-DevGamemode.ps1) | Sends game\gamemode.js to the dev server on the VPS, which loads it while it runs when nothing else changes, and otherwise restarts only that server. |
| [deploy/Deploy-Docs.ps1](deploy/Deploy-Docs.ps1) | Puts the Thornswood docs site on the VPS and keeps it running. |
| [deploy/Deploy-Gamemode.ps1](deploy/Deploy-Gamemode.ps1) | Puts gamemode.js and its gamemode-tables folder (#5191) into the built server and writes a server load order that actually lines up with the client's. |
| [deploy/Deploy-Release.ps1](deploy/Deploy-Release.ps1) | Puts one signed build Release on the dev server, the site or the Discord bot by its tag (#5180, the deploy gate verb that comes first, Patrick 31 Oct 2026; the site and the bot since #5190 and #5187). |
| [deploy/Deploy-Server.ps1](deploy/Deploy-Server.ps1) | Sends the built server up to the VPS and restarts it. |
| [deploy/DeployedBuild.ps1](deploy/DeployedBuild.ps1) | What each server actually runs, where the site can read it. |
| [deploy/DocsPasswordFile.ps1](deploy/DocsPasswordFile.ps1) | Where the site's member password comes from for Deploy-Docs.ps1 -Password, when nobody types it (issue #2116): a file on the box, locked to the box's Administrators and the deploy account. |
| [deploy/Fresh-Checkout.ps1](deploy/Fresh-Checkout.ps1) | Deploy and ship scripts refuse a stale or dirty checkout (#2118). |
| [deploy/GamemodeId.ps1](deploy/GamemodeId.ps1) | What the gamemode says it is as it loads, worked out here the same way, so a deploy can wait for the server to say it loaded what was sent (#3196, #5191): the git blob id of gamemode.js and the git tree id of its tables folder. |
| [deploy/Install-AdminService.ps1](deploy/Install-AdminService.ps1) | Puts the box's GitHub admin service on the VPS (#3107, Patrick's A of 22 Oct 2026): scripts\vps\admin\admin.js, as the task "Thornswood Admin", listening on 127.0.0.1:7791. |
| [deploy/Install-Backup.ps1](deploy/Install-Backup.ps1) | Puts the nightly backup on the VPS: sends vps-nightly-backup.ps1 up, makes a passphrase if there is not one yet, and registers the scheduled task that runs it. |
| [deploy/Install-Bot.ps1](deploy/Install-Bot.ps1) | Puts the Thornswood bot on the VPS and keeps it running. |
| [deploy/Install-Bridge.ps1](deploy/Install-Bridge.ps1) | Puts the box's end of ssh on the VPS (#2753, #2891), the way every machine reaches the box's ssh: scripts\vps\bridge\bridge.js, as the task "Thornswood Bridge", listening on 127.0.0.1:7790. |
| [deploy/Install-DeployAgent.ps1](deploy/Install-DeployAgent.ps1) | Puts the box deploy agent on the VPS (#5180): the Windows service ThornswoodDeployAgent, C:\Thornswood-Agent\thornswood-agent.exe, from the newest signed agent-v<version> Release that .github\workflows\deploy-agent.yml published. |
| [deploy/Install-Gate.ps1](deploy/Install-Gate.ps1) | Puts the deploy gate on the box (#2841): the account thornswood-deploy, which has no administrator rights, its forced command, and the broker that runs the verbs. |
| [deploy/Install-Runner.ps1](deploy/Install-Runner.ps1) | Puts a GitHub Actions runner on the VPS, so the build check runs on every pull request without paying for minutes. |
| [deploy/Install-ThornswoodContent.ps1](deploy/Install-ThornswoodContent.ps1) | Drops Thornswood-Content.esp into the game folder and inserts it into the load order ahead of the city overhauls. |
| [deploy/Install-ThornswoodServer.ps1](deploy/Install-ThornswoodServer.ps1) | Run this ON THE VPS, after Bootstrap-VPS.ps1, as Administrator. |
| [deploy/Install-Tunnel.ps1](deploy/Install-Tunnel.ps1) | Puts the site behind a Cloudflare Tunnel (#5334): cloudflared runs on the box as the task "Thornswood Tunnel" and keeps an outbound connection open to Cloudflare, and Cloudflare sends thornswood.net and www down it to Caddy on 127.0.0.1:443. |
| [deploy/Install-Voice.ps1](deploy/Install-Voice.ps1) | Puts the proximity voice service on the VPS beside the game server and opens the one port it needs. |
| [deploy/LastPluginOnBox.ps1](deploy/LastPluginOnBox.ps1) | Thornswood-Last.esp on a game server, made on the box from its recipe (#2791 step 2, Patrick's A of 26 Oct 2026 on #3721). |
| [deploy/LastPluginRecipe.ps1](deploy/LastPluginRecipe.ps1) | What this checkout's recipe for Thornswood-Last.esp says of the plugin it makes (#2791): the size and sha256 game\data\last-plugin.json names, and the plugin's file header, which the recipe writes out. |
| [deploy/MaxOnline.ps1](deploy/MaxOnline.ps1) | How many people a Thornswood server holds at once: read from the one place it is written, records\most-online.json, and put into server-settings.json. |
| [deploy/Move-RunnersToDrive.ps1](deploy/Move-RunnersToDrive.ps1) | #4048. Move One's runners to its existing Dev Drive, one verified runner at a time. |
| [deploy/New-RunnerDrive.ps1](deploy/New-RunnerDrive.ps1) | Makes the Windows 11 Dev Drive that One's pull request runners live on, so Defender scans what their builds open without holding each file until the scan is done (#4048, #3861; Patrick's answer A on the report page, 27 Oct 2026, q-3861-defender). |
| [deploy/Reload.ps1](deploy/Reload.ps1) | A dev gamemode deploy that changes only gamemode.js puts the new one in place while the dev server runs, and the server loads it there, with nobody dropped and every NPC still in the world (#3196, Patrick's C on 22 Oct 2026). |
| [deploy/Remirror-Site-Feed.ps1](deploy/Remirror-Site-Feed.ps1) | Puts the release feed on the site, so https://thornswood.net/feed/version.json is the same file as this machine's working copy of the feed and every asset it names can be downloaded from thornswood.net. |
| [deploy/Rotate-BotToken.ps1](deploy/Rotate-BotToken.ps1) | Puts a new Discord bot token into both places on the VPS that use it, in one go, and restarts both programs that read it. |
| [deploy/Rotate-ServerPassword.ps1](deploy/Rotate-ServerPassword.ps1) | Changes the server password and hands the new one to the site, so the launcher can fetch it after checking Discord. |
| [deploy/RunnerDriveMove.ps1](deploy/RunnerDriveMove.ps1) | Shared runner-drive move preflight. Defining these functions changes nothing. |
| [deploy/ServerArtifact.ps1](deploy/ServerArtifact.ps1) | The server build as a versioned artifact, kept in the box's store beside the gamemode artifacts. |
| [deploy/ServerBuild.ps1](deploy/ServerBuild.ps1) | Which server files come from the fork, and whether a folder, a zip or a stage holds the build records\server-build.json names. |
| [deploy/ServerContent.ps1](deploy/ServerContent.ps1) | Which Thornswood-Content.esp a game server holds, read off the box, and whether a release may send clients a content plugin that server does not hold (#2308). |
| [deploy/ServerFolderTurn.ps1](deploy/ServerFolderTurn.ps1) | One turn at the game server folders, for the nightly backup and for the scripts that stop a game server and swap its files (#3247). |
| [deploy/ServerOrder.ps1](deploy/ServerOrder.ps1) | The server's load order once the engine loads light plugins (#1715), and the full index a form id is computed from. |
| [deploy/ServerReadyWait.ps1](deploy/ServerReadyWait.ps1) | How long a started game server has to answer on its ports before a deploy puts the old files back. |
| [deploy/ServerSettings.ps1](deploy/ServerSettings.ps1) | Which settings a game server install takes from the release, and which it keeps from the server it replaces. |
| [deploy/ServiceAccount.ps1](deploy/ServiceAccount.ps1) | The account the services that run code we deploy run as (#2578): both game servers, both voice services and Caddy. |
| [deploy/Set-BuildRunners.ps1](deploy/Set-BuildRunners.ps1) | Makes the labels on GitHub's VPS runners match the runner records on main (records\<name>-runners.json): records\build-runners.json caps how many builds run on the box at once. |
| [deploy/Set-DiscordLogin.ps1](deploy/Set-DiscordLogin.ps1) | Points the site at your Discord, which is what decides who gets in anywhere. |
| [deploy/Set-DiscordOnboarding.ps1](deploy/Set-DiscordOnboarding.ps1) | Sets Discord's onboarding (Server Settings, Onboarding) with the bot, from bot\Build-Onboarding.py: the default channels, the questions and what each answer gives, every role and channel looked up by name on the server when it runs. |
| [deploy/Set-RepoAbout.ps1](deploy/Set-RepoAbout.ps1) | Makes the repository's About box on GitHub (the line under its name, the website and the topics) match records\repo-about.json on main. |
| [deploy/Set-Turnstile.ps1](deploy/Set-Turnstile.ps1) | Puts Cloudflare Turnstile's two keys for the report form into the site's config.json on the VPS and restarts the site, so /report draws the check and the site asks Cloudflare about every pass (#3216, Patrick's answer on 22 Oct 2026). |
| [deploy/Setup-Discord.ps1](deploy/Setup-Discord.ps1) | Builds the Thornswood Discord: roles, categories, channels, permissions and the words in the read only channels, in one run. |
| [deploy/Setup-Domain.ps1](deploy/Setup-Domain.ps1) | Puts thornswood.net in front of the docs site, with a real certificate. |
| [deploy/SiteConfigSet.ps1](deploy/SiteConfigSet.ps1) | The one block that changes a single top-level setting in the site's config.json on the VPS and leaves every other setting as it was. |
| [deploy/StopAndMove.ps1](deploy/StopAndMove.ps1) | Stopping what runs from a folder, and then moving its files, on the box: each process waited for until it has exited, and each move tried once. |
| [deploy/Swap.ps1](deploy/Swap.ps1) | Stages a deploy beside what is running, checks it there, and only then swaps it in, keeping what it replaced for a one-command put-back. |
| [dev/Allow-Claude.ps1](dev/Allow-Claude.ps1) | Adds the folders and the script paths a Claude working in this repo needs, to the Claude Code settings file, and reports exactly what it changed. |
| [dev/Build-HarvestTable.ps1](dev/Build-HarvestTable.ps1) | Builds game\data\harvests.json: the table the server needs to say who may pick which plant. |
| [dev/Build-HuntTable.ps1](dev/Build-HuntTable.ps1) | Builds game\data\hunts.json: the table the server needs to answer a carcass. |
| [dev/Build-OreTable.ps1](dev/Build-OreTable.ps1) | Builds game\data\ores.json: the table the server needs to answer an ore vein. |
| [dev/Build-RecipeTable.ps1](dev/Build-RecipeTable.ps1) | Builds game\data\recipes.json: the table the server needs to answer "may this person make this". |
| [dev/Build-SpellTable.ps1](dev/Build-SpellTable.ps1) | Builds game\data\spells.json: the table the server needs to hand somebody a spell. |
| [dev/Check-Backdrop.ps1](dev/Check-Backdrop.ps1) | Read only. Says what the main menu backdrop is in a game folder: the two logo meshes (their hashes, how many shapes each carries, and whether logo01ae.nif's one shape is hidden, which decides whether a second plate draws and whether the game crashes at the main menu) and the wallpaper texture (size, mip levels, format), against what the repo carries in game\menu. |
| [dev/Check-Balance.ps1](dev/Check-Balance.ps1) | Reads the five generated tables and says whether the ladders line up. |
| [dev/Check-Change.ps1](dev/Check-Change.ps1) | Runs, before a push, the gate harnesses this branch's change can reach, from main's nightly map, in a cloud container or on a PC (#5183). |
| [dev/Check-Outside.ps1](dev/Check-Outside.ps1) | Walks the path a first install takes through the things this project does not run itself, and says which of them is broken or has moved. |
| [dev/Check-PackageNotices.ps1](dev/Check-PackageNotices.ps1) | Fails when a NuGet package Dependabot watches is named at another version in THIRD-PARTY.md, the credits page or installer\licences than its project gives it. |
| [dev/Check-Parse.ps1](dev/Check-Parse.ps1) | Says whether every PowerShell script and every game script parses (#5291). |
| [dev/Check-Push.ps1](dev/Check-Push.ps1) | The pre-push hook's checks (#5291): every script parses and the writing rules hold, in the commit being pushed, before it leaves the machine. |
| [dev/Check-Secrets.ps1](dev/Check-Secrets.ps1) | Read only. Looks for anything that must never leave a machine: in the files this repository tracks, in a pack or another zip, or in a built program. |
| [dev/Check-Serena.ps1](dev/Check-Serena.ps1) | Read only. Says how Claude Code on this machine starts Serena, and times one start the way Claude Code makes it: from the repo folder, over stdin and stdout, until Serena answers initialize and lists its tools. |
| [dev/Check-Swallow.ps1](dev/Check-Swallow.ps1) | Counts the silent catches in the launcher and in the PowerShell under scripts\ and installer\, file by file, and fails when any file has more than scripts\dev\swallow-baseline.txt allows, or fewer than it allows with its line not yet lowered. |
| [dev/Check-Words.ps1](dev/Check-Words.ps1) | The writing rules in docs/guide/rules.md, checked on every file people read instead of hoped for; each hit names the file, the line and the rule. |
| [dev/Close-Launcher.ps1](dev/Close-Launcher.ps1) | Shared by every script that writes into the build. |
| [dev/Copy-BoxGuard.ps1](dev/Copy-BoxGuard.ps1) | Writes scripts\vps\BoxGuard.ps1's Get-ThornswoodBoxRefusal into every box script that carries a copy of it. |
| [dev/GamemodeTables.ps1](dev/GamemodeTables.ps1) | Where a builder puts a table the gamemode reads (#5191). |
| [dev/Gate-Harnesses.ps1](dev/Gate-Harnesses.ps1) | Prints the harnesses the build check runs on every pull request: every test-*.js and test-*.ps1 in tests\ and in a product's own tests folder (launcher\tests\) that tests\gate-excluded.txt does not name, one a line, in name order. |
| [dev/Gate-Map.ps1](dev/Gate-Map.ps1) | Fetches the newest map of which gate harnesses a change can reach: the gate-map artifact of main's nightly trace on GitHub's runner (#5183, #4009). |
| [dev/Harness-Files.ps1](dev/Harness-Files.ps1) | Where the test harnesses are, and the name each one goes by. Dot-sourced by Gate-Harnesses.ps1 and Nightly-Harnesses.ps1, so the gate and the nightly can never disagree about which files are harnesses. |
| [dev/Install-Serena.ps1](dev/Install-Serena.ps1) | Installs Serena once, at the version in scripts\dev\serena-version.txt, and points Claude Code on this machine at the installed program, so a session start runs Serena straight away instead of resolving it first. |
| [dev/Install-Thornswood.ps1](dev/Install-Thornswood.ps1) | Everything the client needs, in one run, in the order it has to happen in. |
| [dev/Launcher-Reach.ps1](dev/Launcher-Reach.ps1) | Says whether a pull request's change reaches the job "Launcher builds" (#5292): launcher=true or launcher=false, to the step's outputs. |
| [dev/Lint.ps1](dev/Lint.ps1) | Reports ruff, eslint and PSScriptAnalyzer findings, warnings only, over the files it is given or the whole tree, with each pinned tool fetched once per machine. |
| [dev/Measure-Reclaim.ps1](dev/Measure-Reclaim.ps1) | How much disk deleting a folder would ACTUALLY free. |
| [dev/Merge-HarnessReports.ps1](dev/Merge-HarnessReports.ps1) | Merges the JUnit reports of a run's harness shares into one report, and writes the failing checks, by name, to the run's summary (#5295). |
| [dev/New-ScriptIndex.ps1](dev/New-ScriptIndex.ps1) | Writes scripts\README.md, the list of every PowerShell script under scripts\ and the one line that says what each one is for. |
| [dev/Nightly-Harnesses.ps1](dev/Nightly-Harnesses.ps1) | Runs one share of the test harnesses for the nightly checks, or the ones it is named, one at a time or a few side by side, each on a clock, and always ends by naming every harness that failed and the ten slowest, inside the time it is given. |
| [dev/Nightly-Issue.ps1](dev/Nightly-Issue.ps1) | Keeps one issue on the board for a failing nightly, and closes it the night the checks pass. |
| [dev/Nightly-PlainIssues.ps1](dev/Nightly-PlainIssues.ps1) | Names every issue and issue comment made in the last day that is not written plain. |
| [dev/Nightly-Stray.ps1](dev/Nightly-Stray.ps1) | Names every pull request open more than two days and every branch with no open pull request, in this repository and in the engine fork, reading every page GitHub has. |
| [dev/OwnPlugins.ps1](dev/OwnPlugins.ps1) | Where a builder reads a plugin of the load order from (#2923). |
| [dev/Report-Clone.ps1](dev/Report-Clone.ps1) | Says what One's clone holds that only One can see: every worktree, with its branch, whether it has changes nobody committed and when it last changed; every stash; every local branch, with whether GitHub still has it and how far behind main it is; the folders in temp\ and worktrees\ that no worktree owns. |
| [dev/Run-Gate.ps1](dev/Run-Gate.ps1) | Runs the gate harnesses for build.yml's gate: picks and splits them for its shares, on a pull request only those its change can reach, and runs a share's part (#3114, #5183). |
| [dev/Start-Thornswood.ps1](dev/Start-Thornswood.ps1) | Launches the game the way the launcher's Play() does, without the launcher. |
| [dev/Trace-Gate-Box.ps1](dev/Trace-Gate-Box.ps1) | The part of a gate trace that runs as an administrator: an ETW session that sees every file each gate harness opens, and the reading of it into one list of paths a harness (#3114). |
| [dev/Trace-Gate-Here.ps1](dev/Trace-Gate-Here.ps1) | Runs one step of a gate trace on this machine, as its administrator: the same scripts\dev\Trace-Gate-Box.ps1 the box ran, with no ssh (#5183). |
| [dev/Watch-Foreground.ps1](dev/Watch-Foreground.ps1) | Which window Windows is giving the keyboard to, sampled from outside the game. |
| [mods/Add-Accuracy.ps1](mods/Add-Accuracy.ps1) | RETIRED. DO NOT RUN. Issue #1179: hand-installed Core Impact Framework and Accuracy, then Ships. |
| [mods/Add-Bodies.ps1](mods/Add-Bodies.ps1) | RETIRED. DO NOT RUN. Issue #405: every run poured the nude CBBE and 3BA female body (femalebody_0.nif and _1.nif, shapes 3BA, 3BA_Vagina and 3BA_Anus, no Bra or Panty) back over Game\Data, whatever body had been put there since. |
| [mods/Add-CartTravel.ps1](mods/Add-CartTravel.ps1) | RETIRED. DO NOT RUN. Issue #1179: hand-installed CFTO and its patch, rewrote plugin lists, then Ships. |
| [mods/Add-McmShortcut.ps1](mods/Add-McmShortcut.ps1) | RETIRED. DO NOT RUN. Issue #1179: hand-installed MCM Shortcut NG, then Ships. |
| [mods/Align-LoadOrder.ps1](mods/Align-LoadOrder.ps1) | The client counts its own plugins with Game.GetModCount, which skips every ESL-flagged one because Skyrim gives those no normal index. |
| [mods/Audit-Leftovers.ps1](mods/Audit-Leftovers.ps1) | Measures. Deletes nothing, moves nothing, renames nothing. |
| [mods/Audit-Mods.ps1](mods/Audit-Mods.ps1) | Measures the build and says which parts carry a plugin and which are pure assets, because only the second kind can ever be optional. |
| [mods/Build-Generated.ps1](mods/Build-Generated.ps1) | Builds Thornswood's animation and body files (the behavior files, with Pandora Behaviour Engine+, and BodySlide's body meshes) in a Thornswood game folder, by hand, with the launcher's own code. Never writes into the Steam copy. |
| [mods/Check-CleanInstall.ps1](mods/Check-CleanInstall.ps1) | After installing the Nexus collection into a clean Vortex profile: does the plugin list that install wrote give the game the load order the server checks, with the server's files? |
| [mods/Check-CollectionRules.ps1](mods/Check-CollectionRules.ps1) | Whether the plugin rules the Nexus collection carries hold a clean install to a plugin list's order. |
| [mods/Check-CoveredBodies.ps1](mods/Check-CoveredBodies.ps1) | Says whether every body the game folder shows people is covered by underwear, men and women alike, and exits 2 when one is not. |
| [mods/Check-Editions.ps1](mods/Check-Editions.ps1) | Does anything in the load order need the paid Anniversary upgrade? |
| [mods/Check-FromGame.ps1](mods/Check-FromGame.ps1) | Makes the main menu, the notice board's two meshes and the collection's menus with no gold values from a game's own archives the way the launcher does, and says whether each came out byte for byte (#2827, #3113). |
| [mods/Check-Manifest.ps1](mods/Check-Manifest.ps1) | Says what load order the game server is actually handing out, and how it compares to the one you play with. |
| [mods/Check-Plugins.ps1](mods/Check-Plugins.ps1) | What is enabled that should not be, and what is missing that should be there. |
| [mods/Clean-Everything.ps1](mods/Clean-Everything.ps1) | Finds the old installers, build leftovers, temp files, stale backups and old GitHub release assets across this machine, the server and the source repository, adds up what they are costing, and prints it. |
| [mods/Clean-Leftovers.ps1](mods/Clean-Leftovers.ps1) | The other half of Audit-Leftovers.ps1. That one measures and never touches anything; this one removes what it found. |
| [mods/Enable-MCM.ps1](mods/Enable-MCM.ps1) | RETIRED. DO NOT RUN. Issue #1179: patched SkyUI_SE.esp's light flag by hand. |
| [mods/Find-MissingMasters.ps1](mods/Find-MissingMasters.ps1) | Reads the TES4 header of every plugin in Data and reports any master that is no longer present. |
| [mods/Fix-Icons.ps1](mods/Fix-Icons.ps1) | Windows keeps the picture it once drew for a shortcut in a cache, and goes on showing it long after the icon inside the exe changed. |
| [mods/Fix-MaleBody.ps1](mods/Fix-MaleBody.ps1) | RETIRED. DO NOT RUN. Issue #1179: moved the collection's HIMBO male body aside by hand. |
| [mods/Fix-QuickLoot.ps1](mods/Fix-QuickLoot.ps1) | RETIRED. DO NOT RUN. Issue #1179: switched on MCMHelper.esp in server-settings.json and plugins.txt by hand. |
| [mods/Generated.ps1](mods/Generated.ps1) | Thornswood's animation and body files, for a script: what they are, what they were built from, whether the ones in a game folder are current, and the build itself. Dot-sourced by Build-Generated.ps1, Check-CoveredBodies.ps1 and the harnesses. |
| [mods/LoadOrder.ps1](mods/LoadOrder.ps1) | The load order as the game counts it, and how to put a plugin list into the server's order. |
| [mods/New-CollectionPluginRecord.ps1](mods/New-CollectionPluginRecord.ps1) | Writes records\collection-plugins.json, the collection's plugins with the size and sha256 of each, which the full deploys hold the plugins they send to (#2019, CollectionPlugins.ps1). |
| [mods/OnBox.ps1](mods/OnBox.ps1) | The two scripts Run-OnBox.ps1 sends to the box (issue #2899): the keeper, which makes the run's folder and removes it, and the run. |
| [mods/PluginRuleLoops.ps1](mods/PluginRuleLoops.ps1) | The plugin rules of a collection that LOOT can never keep, because they go against an order the game itself sets. |
| [mods/Rebuild-ContentTables.ps1](mods/Rebuild-ContentTables.ps1) | Rebuilds every table that is read out of the plugins of the load order, in the order they read each other, after a change to one of Thornswood's own plugins in game\content, and says what changed. |
| [mods/Rebuild-OnBox.ps1](mods/Rebuild-OnBox.ps1) | The deploy gate's Rebuild-ContentTables verb (#2841): the whole content chain, scripts\mods\Rebuild-ContentTables.ps1, run by Run-OnBox.ps1 against a server's plugins on the box, from main as main is when the gate reads it. |
| [mods/Rebuild-PullTables.ps1](mods/Rebuild-PullTables.ps1) | Rebuilds the content tables for a pull request on the box and commits them back to its branch, in one run, from any session gh is signed in on, a cloud thread included (#4322). |
| [mods/Remove-DeadRecords.ps1](mods/Remove-DeadRecords.ps1) | Deletes records from Thornswood-Content.esp that nothing uses any more, and refuses to delete one that anything still points at. |
| [mods/Remove-Plugin.ps1](mods/Remove-Plugin.ps1) | RETIRED. DO NOT RUN. Issue #1179: took one plugin out of the build by hand. |
| [mods/Run-OnBox.ps1](mods/Run-OnBox.ps1) | Runs one of the repository's content tools on the VPS box, against the game plugins a game server there already holds, and brings back what the tool wrote into the repository's game\, records\ and docs\systems\ folders. |
| [mods/Send-GameArchives.ps1](mods/Send-GameArchives.ps1) | Puts Skyrim's own archives that the content tools read on the VPS box, in C:\Thornswood-GameData, each checked against records\skyrim-files.json on this machine before it goes and on the box after it lands, and the loose string tables records\game-strings.json names, held to that record the same way. |
| [mods/Set-UnboundMenu.ps1](mods/Set-UnboundMenu.ps1) | RETIRED. DO NOT RUN. Issue #1179: swapped Skyrim Unbound's MCM script by hand. |
| [mods/Show-EslCascade.ps1](mods/Show-EslCascade.ps1) | Answers one question: if the server load order drops every ESL-flagged plugin, how much else has to go with it? |
| [mods/Sync-LoadOrder.ps1](mods/Sync-LoadOrder.ps1) | Build the server's load order from the client's. |
| [ops/Chargen-Log.ps1](ops/Chargen-Log.ps1) | What the server thinks is happening to your character. |
| [ops/Check-Board.ps1](ops/Check-Board.ps1) | Holds the board's cards to the rules docs/guide/the-board.md gives them, from a board.json Read-Board.ps1 wrote, and names every card that breaks one. |
| [ops/Check-Chargen.ps1](ops/Check-Chargen.ps1) | Preflight for character creation. Everything it looks at is something that silently produces a broken first join rather than an error message, so it is worth thirty seconds before starting the server. |
| [ops/Check-DevRosterSeed.ps1](ops/Check-DevRosterSeed.ps1) | Expand the roster seed here-string exactly as Publish-Server would and parse the text that would actually be sent. |
| [ops/Check-Roster.ps1](ops/Check-Roster.ps1) | What is in each server's private folder, by name and size only. |
| [ops/Discord-Hook.ps1](ops/Discord-Hook.ps1) | The Discord webhooks releases post through, kept in one place on the VPS instead of a file on each machine that ships. |
| [ops/List-Untouched.ps1](ops/List-Untouched.ps1) | Lists the open issues nobody has touched for a month, oldest first, for the weekly board review to re-rank (#5185). |
| [ops/Mark-Spot.ps1](ops/Mark-Spot.ps1) | Reads the spots you marked in game and prints them in the shape the content table wants. |
| [ops/New-Character.ps1](ops/New-Character.ps1) | Throws the test character away so the next connect builds a fresh one. |
| [ops/NpcReset.ps1](ops/NpcReset.ps1) | The box half of Reset-Npcs.ps1 (#4595): which saved change forms are NPCs, and moving those aside so each NPC starts again from its plugin record. |
| [ops/Publish-Discord.ps1](ops/Publish-Discord.ps1) | Posts the newest release into the Discord #news channel. |
| [ops/Read-Board.ps1](ops/Read-Board.ps1) | Reads the whole board, every card's Status and Order, into board.json, from a machine that has gh and no board token: a cloud Claude thread (#3192). |
| [ops/Release-List.ps1](ops/Release-List.ps1) | The release list a game server lets go of at its next start (#2351), as Reset-Character.ps1, Wipe-Saves.ps1 (#2668) and New-Character.ps1 (#2673) write it. |
| [ops/Reset-Appearance.ps1](ops/Reset-Appearance.ps1) | Puts a character back into the race menu without deleting them. |
| [ops/Reset-Character.ps1](ops/Reset-Character.ps1) | Throws away the character on the server so the next launch runs creation from the top. |
| [ops/Reset-Npcs.ps1](ops/Reset-Npcs.ps1) | Starts every NPC on one game server again from its plugin record, and leaves every character and every private register as it is (#4595). |
| [ops/Say-Staff.ps1](ops/Say-Staff.ps1) | Posts one staff notice in #staff-updates through the bot, from One, a developer's PC or a cloud thread: only when staff must act: something staff must act on, a server restart or outage staff will see, or a change to how staff do their job. |
| [ops/Sealed.ps1](ops/Sealed.ps1) | The seal a workflow puts on what it sends back to the session that started it, for scripts\vps\Box-Run.ps1 (the deploy gate) and scripts\release\Nexus-Run.ps1 (the Nexus scripts), both #2841. |
| [ops/Set-Collection.ps1](ops/Set-Collection.ps1) | Asks for the collection address and publishes it, in the two places that decide it, the same two Set-Server.ps1 uses. |
| [ops/Set-DevNews.ps1](ops/Set-DevNews.ps1) | Points dev releases at the Discord channel for dev build updates, so they stop being something only the dev launcher ever mentions and stay out of #news, where everybody reads about the build they actually play. |
| [ops/Set-Door.ps1](ops/Set-Door.ps1) | Turns the game server's door on, off, or tells you what it has been seeing. |
| [ops/Set-Ref.ps1](ops/Set-Ref.ps1) | Makes a release tag, or deletes a branch or a tag, on GitHub for a session whose git cannot write refs: a cloud Claude thread (#3107, #3314). |
| [ops/Set-Server.ps1](ops/Set-Server.ps1) | Sets the server everyone connects to, in the two places that decide it, and sends the feed to the VPS (#907). |
| [ops/Wipe-Saves.ps1](ops/Wipe-Saves.ps1) | Starts the world over. Everybody begins again, nothing is claimed, nothing has been looted, and every container in the province is holding what Bethesda put in it. |
| [ops/WorkflowRun.ps1](ops/WorkflowRun.ps1) | Starts a workflow on main and reads the answer its runner left, for a script whose session cannot make the change itself: Set-Ref.ps1 (a ref write, which a cloud session's proxy refuses) and Set-BuildRunners.ps1 (a runner label, which needs the box's GitHub App). |
| [release/Add-VirusTotalComment.ps1](release/Add-VirusTotalComment.ps1) | Optional manual tool: leaves one community comment on a build's VirusTotal report, or says plainly that it is not commenting and carries on. |
| [release/App-Part.ps1](release/App-Part.ps1) | Makes the zip of one app the box deploy agent puts in from a build Release (#5190, #5187): the site, the Discord bot or the voice service, each as the folder it lands in on the box holds it. |
| [release/Assert-PublishSigned.ps1](release/Assert-PublishSigned.ps1) | Helpers for the publish sign gate. Dot-source this from Ship.ps1. |
| [release/Build-Engine.ps1](release/Build-Engine.ps1) | Takes a machine from a fresh clone to a built engine: the SkyMP server and the client runtime, out of the fork in engine\skymp. |
| [release/Build-Front.ps1](release/Build-Front.ps1) | Builds the front, the in-game page Data\Platform\UI comes from, from the fork at the pinned commit, into local\thornswood-front.zip. |
| [release/Build-GameFiles.ps1](release/Build-GameFiles.ps1) | Builds the game files a merge release carries: dev's last release from the site, with this checkout's own files built over it, as one zip and the list of what is in it. |
| [release/Build-Launcher.ps1](release/Build-Launcher.ps1) | Publishes the launcher, Thornswood.exe and the native libraries beside it. |
| [release/Build-Server.ps1](release/Build-Server.ps1) | Compiles the game server out of our fork and puts the result where Deploy-Server.ps1 and Publish-Server.ps1 expect to find it. |
| [release/Build-SetupFiles.ps1](release/Build-SetupFiles.ps1) | Builds the files the launcher's Velopack package carries beside Game for the install's first start, and the list of them. |
| [release/BuildStamp.ps1](release/BuildStamp.ps1) | What a server's gamemode is, written down beside it. |
| [release/Check-Build.ps1](release/Check-Build.ps1) | The server does not check plugin names. It checks size and crc32 of every plugin it names, so the wrong version of a mod is the same to it as not having the mod. |
| [release/Check-CollectionRecord.ps1](release/Check-CollectionRecord.ps1) | Holds records\collection.json, the collection as it should be, to the load order, each mod's page and the servers' order, from the repository alone (#5189). |
| [release/Check-CollectionRevisions.ps1](release/Check-CollectionRevisions.ps1) | Holds Nexus's newest published collection revision, the record and both feeds to each other, and keeps one issue on the board for the rebuild while they part (#4068). |
| [release/Check-Records.ps1](release/Check-Records.ps1) | Holds the committed high-risk records to their shape and version, fail closed (#2180). |
| [release/Check-ShipReady.ps1](release/Check-ShipReady.ps1) | Whether THIS machine can run a release, and what is missing if it cannot. |
| [release/Clean-NewsRepeats.ps1](release/Clean-NewsRepeats.ps1) | Takes out of a channel's published notes every line an older note already said, so the News tab and the site list each change once. |
| [release/Clear-News.ps1](release/Clear-News.ps1) | Takes every published note off a channel: the launcher's News tab, the site's News page for main, and the record of the channel's Discord posts. |
| [release/Close-ShippedIssues.ps1](release/Close-ShippedIssues.ps1) | Closes the issues in Done whose fix a main Ship carries, each with the test task its pull request wrote, and says which it closed and which stay open; with -Dev, writes the Dev test tasks a dev Ship carries, closing nothing. |
| [release/Collect-ReleaseNotes.ps1](release/Collect-ReleaseNotes.ps1) | The note for the next release, joined from the "Release note:" lines of the pull requests merged since the last one (#5179), so nobody writes a note at release time from titles meant for the team. |
| [release/CollectionRecord.ps1](release/CollectionRecord.ps1) | The collection as it should be, records\collection.json, and everything that reads it (#5189). |
| [release/CollectionRevision.ps1](release/CollectionRevision.ps1) | Which collection revision a release is built against, and the one place that number comes from (#3597). |
| [release/Compare-NexusLayout.ps1](release/Compare-NexusLayout.ps1) | Says whether a collection revision's layout record (what Install-NexusRevision.ps1 writes) is the same as another layout record, or the same as what Vortex deployed into a game folder, file by file and plugin by plugin (#2969). |
| [release/Dev-News.ps1](release/Dev-News.ps1) | Which notes on the dev feed are marked DEV, worked out from main's feed, and the one place that writes those marks and the dev feed's mainVersion. |
| [release/EngineArtifact.ps1](release/EngineArtifact.ps1) | CI's engine build of the pin, the public fork's own build of the commit (thornswood-engine-<commit>), made this machine's engine build after every file in it is held to the checkout's records. |
| [release/EngineJobs.ps1](release/EngineJobs.ps1) | How many projects an engine build compiles at once, and whether a compile that failed ran the machine out of memory. |
| [release/EnginePin.ps1](release/EnginePin.ps1) | What moves the engine pin by itself (#5148), dot-sourced by Update-EnginePin.ps1, Write-EnginePinText.ps1 and .github\workflows\engine-pin.yml. |
| [release/EngineRecords.ps1](release/EngineRecords.ps1) | The records engine.yml makes for a pin, carried from the run to the pin pull request in the run's log (#3399). |
| [release/Export-ServerPayload.ps1](release/Export-ServerPayload.ps1) | Packages everything the VPS needs into one zip. |
| [release/Feed-Json.ps1](release/Feed-Json.ps1) | The one way a channel's version.json is written (#1050). |
| [release/Feed-News.ps1](release/Feed-News.ps1) | The notes the launcher's News tab shows, wherever the feed keeps them (#1050). |
| [release/Feed-Rules.ps1](release/Feed-Rules.ps1) | Which packs on the update feed a launcher can actually download. |
| [release/Feed-Store.ps1](release/Feed-Store.ps1) | Where each channel's feed, its release baseline and their history are kept, and the only code that reads or writes them there (#907). |
| [release/ForkEngineBuild.ps1](release/ForkEngineBuild.ps1) | Finds the public fork's own build of an engine commit, and puts it where a build of that commit on this machine would be, for engine.yml to record. |
| [release/Front.ps1](release/Front.ps1) | What Build-Front.ps1 and Go.ps1 share about the front build, the page skymp5-front's webpack makes for Data\Platform\UI: the record of it, the zip it travels in, and the check that a zip is the recorded build. |
| [release/Get-EngineArtifact.ps1](release/Get-EngineArtifact.ps1) | Fetches CI's engine build of the pin (the public fork's own build of it), holds every file in it to records\client-build.json and records\server-build.json, and makes it this machine's engine build. |
| [release/Get-EngineRecords.ps1](release/Get-EngineRecords.ps1) | Takes the records an engine.yml run made out of its log and writes them into this checkout's records\, for the pin pull request. |
| [release/Get-ScratchDir.ps1](release/Get-ScratchDir.ps1) | Says where a short-lived build scratch folder goes, so Ship and Install-Thornswood take their launcher build (and the CI setup stub) from one place instead of each calling [IO.Path]::GetTempPath(). |
| [release/Get-SevenZip.ps1](release/Get-SevenZip.ps1) | Puts 7-Zip's own Linux build (7zz, 25.01) on a Linux machine, checked against its pinned sha256, and prints where it is, so a cloud session can unpack every archive of the collection (#2969). |
| [release/Go.ps1](release/Go.ps1) | Installs the front, the overlays and the plugins, then reports what the server is doing. |
| [release/Install-Launcher.ps1](release/Install-Launcher.ps1) | Puts a launcher that Build-Launcher.ps1 has already built into an install, and does the things around it that only an install should do. |
| [release/Install-NexusRevision.ps1](release/Install-NexusRevision.ps1) | Lays out one revision of the Thornswood collection on Nexus Mods (slug 7essxf) into a game folder, the way Vortex installs and deploys it, without Vortex (#2754). |
| [release/LauncherVersion.ps1](release/LauncherVersion.ps1) | Works out the launcher's number from git, so it is never committed. |
| [release/LogHandBack.ps1](release/LogHandBack.ps1) | A file handed back from a workflow run in its job's log rather than as an artifact. |
| [release/MergeRelease.ps1](release/MergeRelease.ps1) | What .github/workflows/merge-release.yml works out between steps (#5179): the release's names, the newest Release before it, and which parts the merge changed. |
| [release/New-ClientBuildRecord.ps1](release/New-ClientBuildRecord.ps1) | Records what the client runtime is and which fork commit it was built from, into records\client-build.json. |
| [release/New-ClientLicenceRecord.ps1](release/New-ClientLicenceRecord.ps1) | Records which libraries are in the client files, vcpkg's and the others, with each one's licence text, into records\client-licences.json and records\client-licences\. |
| [release/New-CollectionRecord.ps1](release/New-CollectionRecord.ps1) | Writes records\collection.json, the collection as it should be (#5189), from a revision laid out by Install-NexusRevision.ps1 -Record -KeepPlugins. |
| [release/New-FeedRoot.ps1](release/New-FeedRoot.ps1) | Stages the folder a release from the feed is built from: every file the channel's last release left installed, from the site, by its sha256. |
| [release/New-NexusRevision.ps1](release/New-NexusRevision.ps1) | Makes the next revision of the Thornswood collection on Nexus Mods (slug 7essxf), as a draft, from the revision published now with one or more of its mods moved to a new Nexus file; and publishes a draft once it has been checked (#2914). |
| [release/New-ServerBuildRecord.ps1](release/New-ServerBuildRecord.ps1) | Records every server file the fork builds and the one commit they were built from, into records\server-build.json. |
| [release/New-SignedManifest.ps1](release/New-SignedManifest.ps1) | Writes the manifest a Release for the box deploy agent carries (#5180), and the catalog over it that Sign-OnRunner.ps1 then signs. |
| [release/New-SkyrimFilesRecord.ps1](release/New-SkyrimFilesRecord.ps1) | Records every file of the pinned Skyrim build, from the depot manifests the Downgrade asks Steam for, into records\skyrim-files.json. |
| [release/Nexus-Run.ps1](release/Nexus-Run.ps1) | Runs one of the Nexus scripts with Patrick's Nexus API key from a session that does not hold the key, a cloud thread included (#2841). |
| [release/Nexus.ps1](release/Nexus.ps1) | The one place the release scripts talk to Nexus Mods from, with Patrick's personal API key (#2914). |
| [release/NexusModPlan.ps1](release/NexusModPlan.ps1) | What Vortex would install from one mod archive, worked out the way Install-NexusRevision.ps1 lays a whole revision out (NexusLayout.cs), for a mod the collection does not carry yet (#5189). |
| [release/NexusPublished.ps1](release/NexusPublished.ps1) | The newest published revision of a Nexus collection, as Nexus says it now (#4068). |
| [release/Note-Repeats.ps1](release/Note-Repeats.ps1) | Whether a note tells a channel something it has already been told (#3320). |
| [release/Note-Rules.ps1](release/Note-Rules.ps1) | What release notes may say. Ship.ps1 dot-sources this and refuses notes that break it, before anything is built. tests\test-note-rules.ps1 drives the same function, so the rule and its test cannot disagree. |
| [release/Open-EnginePinPr.ps1](release/Open-EnginePinPr.ps1) | Opens the engine pin pull request from engine-pin/next, or brings the open one's title and body up to the branch's head commit. |
| [release/Publish-CollectionRecord.ps1](release/Publish-CollectionRecord.ps1) | Makes the collection on Nexus what records\collection.json says, once a change to that record is merged (#5189). |
| [release/Publish-FridaSources.ps1](release/Publish-FridaSources.ps1) | The source of what is inside frida-gum.lib, on one permanent Release of this repository (#3287, Patrick's answer C of 26 Oct 2026). |
| [release/Publish-Pack.ps1](release/Publish-Pack.ps1) | Builds the optional packs listed in optional-packs.txt, sends them to the site, and adds them to version.json so every launcher offers them under Add-ons on its Diagnostics page. |
| [release/Publish-PostShip.ps1](release/Publish-PostShip.ps1) | Runs what follows a published tip: the host feed remirror. VirusTotal is no longer part of publish; use Publish-VirusTotal.ps1 by hand if you want a report. |
| [release/Publish-ReleaseFiles.ps1](release/Publish-ReleaseFiles.ps1) | Puts every file one release names on a GitHub Release of this repository, on the release's own tag, so downloads and updates come from Releases (#3686, Patrick's decision of 26 Oct for going public). |
| [release/Publish-Server.ps1](release/Publish-Server.ps1) | Run this ON YOUR LAPTOP. It packs the server, sends it to the VPS, installs it there and checks it came up. |
| [release/Publish-ServerOnBox.ps1](release/Publish-ServerOnBox.ps1) | The deploy gate's Publish-Server and Publish-Server-Main verbs (#2841): the pin's server build published from the box's store, run on the box itself from main as the gate reads it. |
| [release/Publish-Update.ps1](release/Publish-Update.ps1) | Diffs the current build against the last published state, packs only what changed, sends it to the site (thornswood.net/feed[-dev]/assets/<sha256>, #897), and updates version.json so everyone's launcher picks it up. |
| [release/Publish-VirusTotal.ps1](release/Publish-VirusTotal.ps1) | Optional manual tool: sends a file to VirusTotal, or says plainly that it is not sending and carries on. Not called from publish. |
| [release/Read-JsonFile.ps1](release/Read-JsonFile.ps1) | ConvertFrom-ThornswoodJson: JSON text read from a file, parsed, or a stop that names the file. |
| [release/Read-NexusFile.ps1](release/Read-NexusFile.ps1) | Reads one file of a Nexus mod with Patrick's Nexus API key and says what a change to records\collection.json needs from it (#5189). |
| [release/RecordShape.ps1](release/RecordShape.ps1) | The shape and version each high-risk JSON record must have, checked fail closed (#2180, first slice). docs\JSON-STATE-INVENTORY.md lists every critical JSON file, who writes it and who reads it. |
| [release/Refresh-DevNews.ps1](release/Refresh-DevNews.ps1) | Marks the dev feed's notes DEV again against what main has published, and sets its mainVersion, with no release. |
| [release/Release-Baseline.ps1](release/Release-Baseline.ps1) | What a release is diffed against, and the record each release publishes of what it left installed (#441). |
| [release/Release-Manifest.ps1](release/Release-Manifest.ps1) | The signed release manifest, phase B of docs\SIGNED-RELEASES.md (#2163). |
| [release/Release-Name.ps1](release/Release-Name.ps1) | One name for each release, recorded in the feed and the store, and a git tag on the commit it was built from (#444). |
| [release/Repair-Manifest.ps1](release/Repair-Manifest.ps1) | Takes packs with no download url back out of version.json and sends the fix. |
| [release/RepoPlugins.ps1](release/RepoPlugins.ps1) | The plugins this repository builds and ships itself, in one list (#2486). |
| [release/Rollback-Feed.ps1](release/Rollback-Feed.ps1) | Puts a channel's feed back to an earlier release, so every launcher on that channel moves its game files back to what that release installed, with no hand editing of version.json (#442). |
| [release/Scrub-Feed.ps1](release/Scrub-Feed.ps1) | Takes Bethesda's files and one machine's own files out of what a channel's feed has already published: every pack that carries one is rebuilt without it, every release record that names one is written again without it, the feed and the store's baseline are sent through Feed-Store.ps1 like any other feed edit, and the old bytes are then deleted from the site once no feed names them (#1152, #1227, #1229, #1239). |
| [release/Send-NexusFile.ps1](release/Send-NexusFile.ps1) | Uploads a new version of one of our files on Nexus Mods, in place of the version it has now, from a local archive (#2914). |
| [release/Set-NexusDescription.ps1](release/Set-NexusDescription.ps1) | Adds a line to the description of one or more of our mods on Nexus Mods, or puts back a description from a file, and reads the page back to prove what Nexus kept (#2914). |
| [release/Set-NexusKey.ps1](release/Set-NexusKey.ps1) | Puts Patrick's Nexus Mods API key on One, asked at a prompt and never shown, or says whether the key this machine has works (#2914). |
| [release/Setup-ShipMachine.ps1](release/Setup-ShipMachine.ps1) | Checks and prepares a Windows machine to Ship dev, and says what is left for a person to do. |
| [release/Ship-OnBox.ps1](release/Ship-OnBox.ps1) | The deploy gate's Ship verbs (#2841): a Ship from the feed run on the box itself, from main as the gate reads it, so a cloud session ships with no key to the box (Patrick, 30 Oct 2026: "we arent doing this on One"). |
| [release/Ship-Rules.ps1](release/Ship-Rules.ps1) | The one list of what never leaves a machine inside a Thornswood pack. |
| [release/Ship-Stack.ps1](release/Ship-Stack.ps1) | One Dev or Main command that runs the gamemode deploy and the host feed remirror. |
| [release/Ship.ps1](release/Ship.ps1) | Publishes the game files and server parts that changed, in a single release, to the main build or the dev build. |
| [release/ShippedBytes.ps1](release/ShippedBytes.ps1) | The bytes a file of this checkout goes out as, the same from every machine (#2903). |
| [release/Sign-Artifact.ps1](release/Sign-Artifact.ps1) | Signs a built binary, or says plainly that it is not signing and carries on. |
| [release/Sign-OnGitHub.ps1](release/Sign-OnGitHub.ps1) | Signs the release manifest's catalog on GitHub's runner in the public engine fork, and checks it the way every installed launcher checks a launcher (#2903, Patrick's A of 20 Oct). |
| [release/Sign-OnRunner.ps1](release/Sign-OnRunner.ps1) | Signs files with ThornswoodRelease on GitHub's Windows runner, in a run of main's own workflow, and holds each to the launcher's own check before it says yes (#5180). |
| [release/Sign-ReleaseCatalog.ps1](release/Sign-ReleaseCatalog.ps1) | Signs the release manifest's catalog with ThornswoodRelease and checks it the way every installed launcher checks a launcher (#2163, phase B). |
| [release/Source-Notice.ps1](release/Source-Notice.ps1) | The note and licence texts that go inside every download on the update feed that carries SkyMP files. |
| [release/Sync-Client.ps1](release/Sync-Client.ps1) | Puts the client runtime built from the fork into the game folder, and refuses any file that is not the recorded build. |
| [release/Test-LauncherStarts.ps1](release/Test-LauncherStarts.ps1) | Starts a published Thornswood.exe for real and holds it to opening its window and staying up (#5524). |
| [release/Test-SignPilot.ps1](release/Test-SignPilot.ps1) | Signs and verifies a throwaway TEST artifact only, to pilot the signed release design (issue #2163). Never touches a release or the feed. |
| [release/Update-Checkout.ps1](release/Update-Checkout.ps1) | Moves a checkout that sits detached at origin/main, the shared clone on One, to the newest origin/main with engine\skymp at the commit it pins, or says why it cannot and moves nothing. |
| [release/Update-EnginePin.ps1](release/Update-EnginePin.ps1) | Moves the engine pin in this checkout to a fork commit engine.yml recorded: the pin, the records, the front, the notice lines, and the pull request's title and body. One command for what was six hand steps. |
| [release/Update-ShipRoot.ps1](release/Update-ShipRoot.ps1) | Brings a ship root's game folder up to date with Vortex's deployment and puts the recorded client in it, or says why it cannot; Ship runs it before anything is packed. |
| [release/Wait-Deployment.ps1](release/Wait-Deployment.ps1) | A release counts as shipped only when the box says it is running it. |
| [release/Where.ps1](release/Where.ps1) | Says where the engine fork and the build output are, so every script asks one place instead of carrying its own copy of a path. |
| [release/Write-EnginePinText.ps1](release/Write-EnginePinText.ps1) | Writes the engine pin's lines in THIRD-PARTY.md and site\data\site\credits.md from the records, or with -Check says which ones differ from them. |
| [vps/admin/ShipAccess.ps1](vps/admin/ShipAccess.ps1) | Get-ThornswoodShipAccess: the box admin App's token for one release step through the deploy gate (#2841), from scripts\vps\admin\ship-access.js: Actions write on the engine fork and Thornswood, Contents read on Thornswood, ended by GitHub within the hour. |
| [vps/Backup-Server.ps1](vps/Backup-Server.ps1) | Pulls everything off the server that could not be rebuilt from the repo, and puts it on this machine as a dated zip encrypted with the backup passphrase, thornswood-backup-<yyyyMMdd-HHmm>.zip.enc: in local\backups in the repository (Where.ps1 Backups), or the folder -Out names. |
| [vps/Bootstrap-VPS.ps1](vps/Bootstrap-VPS.ps1) | Run this ON THE VPS, once, in the PowerShell 5.1 that ships with Windows Server 2022. |
| [vps/Bot-Service.ps1](vps/Bot-Service.ps1) | Runs the Thornswood bot as a Windows service under its own account, and stops and starts it by name (issue #465). |
| [vps/Box-Run.ps1](vps/Box-Run.ps1) | Runs one verb of the deploy gate on the box (#2841), from any session gh is signed in on, a cloud thread included, with no key to the box. |
| [vps/BoxFirewall.ps1](vps/BoxFirewall.ps1) | Where the box keeps its firewall rules, and how a change to them takes effect (#3896). |
| [vps/BoxGuard.ps1](vps/BoxGuard.ps1) | What a box script asks before it changes anything: is this the box? |
| [vps/Check-LiveGamemode.ps1](vps/Check-LiveGamemode.ps1) | Says whether the gamemode running on the VPS is the one in this repo. |
| [vps/Check-Load.ps1](vps/Check-Load.ps1) | Answers the only question worth asking before paying for a bigger server: what is this one actually running out of. |
| [vps/Check-ProdParity.ps1](vps/Check-ProdParity.ps1) | Compares the VPS's own facts with what the repository says it should be (binds, Caddy, tasks, services, live file hashes, TLS dates, settings shape) and writes a redacted parity report; read-only (issue #2165). |
| [vps/Check-RehearsalDue.ps1](vps/Check-RehearsalDue.ps1) | Says whether the monthly hands-on restore rehearsal is due, from the Last rehearsed line in RESTORING.md in the private ops repo, and fails once it is overdue. |
| [vps/Check-RunnerIsolation.ps1](vps/Check-RunnerIsolation.ps1) | Checks what the self-hosted GitHub Actions runners on the VPS can reach (accounts, groups, production paths, leftovers, firewall, which workflows and pull requests run there, the repository's Actions settings) and writes a redacted report; read-only (issue #2161). |
| [vps/Check-ServerPriority.ps1](vps/Check-ServerPriority.ps1) | Reads, and changes nothing: the priority the live and dev game servers and the live and dev voice services run at on the VPS (#2491). |
| [vps/Check-ServiceOwners.ps1](vps/Check-ServiceOwners.ps1) | Reads, and changes nothing: whether one box service can still reach what another makes through LOCAL SERVICE, the account they all run as (#4077). |
| [vps/Check-Site.ps1](vps/Check-Site.ps1) | Asks whether thornswood.net is actually working: from the outside first, the way a visitor or an uptime monitor sees it, and then from the box, the way the site sees Discord. |
| [vps/Check-VoiceInstall.ps1](vps/Check-VoiceInstall.ps1) | Expand Install-Voice's here-string exactly as the script does and look at the text that would actually be sent. |
| [vps/Clear-OldWorldCopies.ps1](vps/Clear-OldWorldCopies.ps1) | Removes the copies of the world that every server install before #446 left in the VPS temp folder, keeping the newest of each kind (issue #1074). |
| [vps/Delete-Person.ps1](vps/Delete-Person.ps1) | Carries out a deletion request (issue #2351). |
| [vps/Fetch-Backups.ps1](vps/Fetch-Backups.ps1) | Brings the nightly backups off the VPS onto this machine, and checks that what arrived is readable. |
| [vps/Forecast-Storage.ps1](vps/Forecast-Storage.ps1) | Records the VPS disk free space over time and forecasts when it reaches the watchdog's DISK LOW and DISK CRITICAL lines, refusing to forecast from too few samples, and tells staff when the forecast turns. |
| [vps/gate/Gate.ps1](vps/gate/Gate.ps1) | The deploy key's forced command (#2841). |
| [vps/gate/GateBroker.ps1](vps/gate/GateBroker.ps1) | The deploy gate's broker (#2841). The task "Thornswood Gate" runs it as SYSTEM from boot, out of C:\Thornswood-Gate, which only SYSTEM and Administrators may change (scripts\deploy\Install-Gate.ps1 puts it there and registers the task). |
| [vps/gate/GateRules.ps1](vps/gate/GateRules.ps1) | What the deploy gate (#2841) will run, as functions with no side effects, so the box's broker, the client and tests\test-2841-deploy-gate.ps1 all hold a line to the same rules. |
| [vps/gate/Update-Gate.ps1](vps/gate/Update-Gate.ps1) | The deploy gate's Update-Gate verb (#5178): puts main's own Gate.ps1, GateBroker.ps1 and GateRules.ps1 in place of the installed ones and restarts the broker on them, with nobody on One. |
| [vps/Get-Logs.ps1](vps/Get-Logs.ps1) | Brings the server's own logs down to this machine so they can be read whole. |
| [vps/Get-ProdFacts.ps1](vps/Get-ProdFacts.ps1) | Runs ON THE VPS, read-only: prints the box's own facts (listeners, tasks, services, file hashes, certificate dates, versions, setting names) as JSON for Check-ProdParity.ps1, never a secret value (issue #2165). |
| [vps/Get-RunnerFacts.ps1](vps/Get-RunnerFacts.ps1) | Runs ON THE VPS, read-only: prints what each GitHub Actions runner account can reach (groups, rights on production paths, leftovers in its work folders, firewall rules, setting names) as JSON for Check-RunnerIsolation.ps1, never a secret value (issue #2161). |
| [vps/Get-RunnerJobs.ps1](vps/Get-RunnerJobs.ps1) | Lists the GitHub Actions jobs one runner started after a given time, with how each ended and which step failed, and says whether one of them passed; read-only (issue #2161). |
| [vps/Grant-BoxAccess.ps1](vps/Grant-BoxAccess.ps1) | Gives one person, or one machine, its own way into the box, or takes it away, and touches nobody else's (#2891). |
| [vps/Harden-VPS.ps1](vps/Harden-VPS.ps1) | Closes the VPS to everything but ssh with a key: proves key login works, then turns ssh password login off and turns Remote Desktop off, and the Windows services and telemetry the box never uses, and moves Windows Update and its maintenance to 4 AM. |
| [vps/Hold-Server.ps1](vps/Hold-Server.ps1) | Holds a server on the box stopped on purpose, so the watchdog leaves it alone (#5155). |
| [vps/Keep-RunnerLogs.ps1](vps/Keep-RunnerLogs.ps1) | The build runners on the box keep every log they write in their _diag folders and nothing ever removed one: 1.6 GB and about 4,000 files on 21 Oct 2026, the oldest from 25 Sep (#3184). -Install puts vps-runner-logs.ps1 on the box as C:\Thornswood-Watch\runner-logs.ps1 and a task that runs it at 4:30 AM every day as SYSTEM, which removes the runner and worker logs older than 14 days. vps-runner-logs.ps1 says exactly what it removes. |
| [vps/Lock-Folder.ps1](vps/Lock-Folder.ps1) | The one place the creators of the VPS service folders get their lock from (follow-up to issues #1183 and #1691): Watch-Services.ps1 and Watch-Load.ps1 for C:\Thornswood-Watch, Setup-Domain.ps1 for C:\Thornswood-Caddy, and Artifact.ps1 and Swap.ps1 for C:\Thornswood-Deploys, and Grant-BoxAccess.ps1 for the copies it keeps in C:\ProgramData\ssh\box-access-before (#3034). |
| [vps/Lock-VpsFolders.ps1](vps/Lock-VpsFolders.ps1) | Takes the rule that lets every account on the box read them off the game servers', the voice services' and the backups' folders, now rather than at each one's next install (issues #1105 and #1173). |
| [vps/Profile-GameServer.ps1](vps/Profile-GameServer.ps1) | Where a game server's processor time goes (#3181). |
| [vps/Protect-BackupZip.ps1](vps/Protect-BackupZip.ps1) | Protect-ThornswoodBackupZip encrypts a backup zip into the TSBK1 file the nightly backup writes (vps-nightly-backup.ps1, "encrypt"), the one format Restore-Backup.ps1 opens: "TSBK1", a 16 byte salt, a 16 byte IV, the zip in AES-256-CBC, then an HMAC-SHA256 over everything after the five letters. |
| [vps/Prove-SecretOffCommandLines.ps1](vps/Prove-SecretOffCommandLines.ps1) | Proves, on one real run, that a secret-sending script keeps the value off every command line on the VPS (issue #1212, the person check of #451). |
| [vps/Read-Availability.ps1](vps/Read-Availability.ps1) | Says how many minutes each service was down over a window, and what share of the window it was up, from the down and back lines the watchdog writes into alerts.jsonl. |
| [vps/Read-LauncherStarts.ps1](vps/Read-LauncherStarts.ps1) | Says how long the launcher took to start on the machines of the people who played, per launcher version: how many starts, the middle one, the one slower than nine in ten, the slowest, and how much of the middle start the mod check took. |
| [vps/Read-Load.ps1](vps/Read-Load.ps1) | Says which service is using the box, from the record vps-load.ps1 keeps on it. |
| [vps/Read-Online.ps1](vps/Read-Online.ps1) | Says how many people are on each game server, live and dev, from the online.json each server announces on its resources port (3000 live, 7788 dev), the same file Restart-Server.ps1 and the launcher read. |
| [vps/Read-ServerHolders.ps1](vps/Read-ServerHolders.ps1) | Says what has a game server's folder open right now, while the server runs, and every process of that server's task with it, so that what an install has to stop before it moves the folder aside is a measurement and not a guess. |
| [vps/Rehearse-OnBox.ps1](vps/Rehearse-OnBox.ps1) | The monthly restore rehearsal (#5020, #5175), run on the box from the cloud through the deploy gate's Rehearse-Restore verb, with a bot loading the character (#5196) where a person used to load it on One. |
| [vps/Remote.ps1](vps/Remote.ps1) | Runs a bit of PowerShell on the VPS, properly. |
| [vps/Remove-HandMadeTasks.ps1](vps/Remove-HandMadeTasks.ps1) | Takes the two SYSTEM tasks somebody made by hand on the box, and the folders they run from, off the box (issue #3288). |
| [vps/Renew-BoxKey.ps1](vps/Renew-BoxKey.ps1) | Gives one of the two keys a workflow of the ops repository holds a new key pair, on the box, and puts the new private half straight into that workflow's GitHub environment (#2862, Patrick's A on the report page's q-retire-box-keys, 31 Oct 2026: box keys are renewed from the cloud, never made new, and never from One). |
| [vps/Request-Restart.ps1](vps/Request-Restart.ps1) | Tells the live server to warn everybody and then clear them out, without needing to be standing in the world to type /restart. |
| [vps/Restart-Server.ps1](vps/Restart-Server.ps1) | Restarts a Thornswood service on the VPS. Nothing is copied and nothing is built: this only stops it and starts it again. |
| [vps/Restore-Backup.ps1](vps/Restore-Backup.ps1) | Opens one of the nightly backups: checks it has not been tampered with, decrypts it, and unpacks it into a folder you name. |
| [vps/Restore-Box.ps1](vps/Restore-Box.ps1) | Puts a nightly backup back onto a new VPS, run from this machine. |
| [vps/Restore-Server.ps1](vps/Restore-Server.ps1) | Puts a nightly backup's world back into a game server folder and checks the result would start: the load order resolves and the characters are there. |
| [vps/Roll-Log.ps1](vps/Roll-Log.ps1) | Rolls a log just before the service that writes it starts. |
| [vps/Seal.ps1](vps/Seal.ps1) | How a secret held by GitHub reaches the box without passing through any session, chat or log in a form anybody can read (#3216, Patrick's A of 22 Oct 2026). |
| [vps/Send-Backups.ps1](vps/Send-Backups.ps1) | Sends each night's encrypted backup off the box to the Oracle VM, where it goes on to Google Drive (Patrick, 31 Oct 2026, #2862). |
| [vps/Send-Script.ps1](vps/Send-Script.ps1) | The one way a script here runs PowerShell on the VPS. |
| [vps/Send-Secret.ps1](vps/Send-Secret.ps1) | How a secret goes to the VPS: on ssh's standard input, never on a command line. |
| [vps/ServerHold.ps1](vps/ServerHold.ps1) | A hold: a server stopped on purpose says so, and the watchdog leaves it stopped until the hold ends (#5155). |
| [vps/Set-InboundRules.ps1](vps/Set-InboundRules.ps1) | Turns off every enabled inbound Allow firewall rule on the box that records\prod-parity.json does not list ("inboundRules"), WinRM from any address among them, and says which (#3807); with -Own, moves the rules the box keeps into its own firewall policy and has the firewall ignore local rules (#3896). |
| [vps/Set-SshScope.ps1](vps/Set-SshScope.ps1) | Limits which addresses may reach ssh on the VPS (port 22), after proving key login, refusing a list that leaves this machine out, and with a put back the box runs by itself if the new login fails. |
| [vps/Set-TimeWait.ps1](vps/Set-TimeWait.ps1) | Sets TcpTimedWaitDelay to 30 seconds on the VPS, so the box stops dropping connections from the cloud before TLS (#2946), and restarts the box for it when asked and nobody is on either server. |
| [vps/Set-Vps.ps1](vps/Set-Vps.ps1) | Renames the game's own name, the one name everything reaches the box by. |
| [vps/Set-WebFirewall.ps1](vps/Set-WebFirewall.ps1) | Lets the box take TCP 80 and 443 only from Cloudflare's ranges, so a forged SYN from anywhere else gets no SYN-ACK back (#2995). -Open puts both back to any address. |
| [vps/Setup-CloudSsh.ps1](vps/Setup-CloudSsh.ps1) | Sets up ssh to the box from a cloud Claude thread (#2753). |
| [vps/Setup-SshKey.ps1](vps/Setup-SshKey.ps1) | Sets a PC up to reach the box over ssh, through the bridge, with a key and a token of its own (#2891). |
| [vps/Show-BotLog.ps1](vps/Show-BotLog.ps1) | What the bot has been saying, without redeploying it to find out. |
| [vps/Start-Backup.ps1](vps/Start-Backup.ps1) | Takes a backup now, on the box, with the nightly's own task, and waits for that run to end (#2862). |
| [vps/Strip-Uploads.ps1](vps/Strip-Uploads.ps1) | Takes what each picture and recording already in the site's uploads says about where and when it was made out of it, the way the site now does to every upload as it lands (#3648). |
| [vps/Upgrade-OpenSsh.ps1](vps/Upgrade-OpenSsh.ps1) | Upgrades the box's OpenSSH for Windows to a release with a post-quantum key exchange, keeping the pinned host keys: proves key login, swaps sshd on the box, proves a new login with the pinned key negotiates a post-quantum key exchange, and only then keeps it. |
| [vps/vps-capture-443.ps1](vps/vps-capture-443.ps1) | Captures the SYN and RST packets on port 443 at the box's network card for a set time, so #2946 can see whether the TLS connects from a cloud session that stall and then reset ever reach the box, and whether the box answers them. |
| [vps/vps-dev-instance.ps1](vps/vps-dev-instance.ps1) | Runs ON the VPS. Makes the dev game server and the dev voice server beside the live ones, from copies of the live installs, on their own ports, with their own scheduled tasks and firewall rules. |
| [vps/vps-firewall-policy.ps1](vps/vps-firewall-policy.ps1) | Runs ON THE VPS, sent there by Set-InboundRules.ps1 -Own: moves every rule the box keeps into its own firewall policy and tells the firewall to ignore local rules, so no installer can open a port on the box (#3896). |
| [vps/vps-freeze.ps1](vps/vps-freeze.ps1) | Runs ON the old VPS on the day the server moves: stops everything that writes what a backup takes, then takes the last backup. |
| [vps/vps-harden.ps1](vps/vps-harden.ps1) | Runs ON THE VPS, sent there by Harden-VPS.ps1: turns ssh password login off, turns Remote Desktop off and the Windows services and telemetry the box never uses, and moves Windows Update and its maintenance to 4 AM, leaving ssh on port 22 alone. |
| [vps/vps-inbound-rules.ps1](vps/vps-inbound-rules.ps1) | Runs ON THE VPS, sent there by Set-InboundRules.ps1: turns off every enabled inbound Allow firewall rule that is not on the box's list, and says which (#3807). |
| [vps/vps-load.ps1](vps/vps-load.ps1) | Runs ON the VPS, every five minutes, as the scheduled task that Watch-Load.ps1 -Install puts there. |
| [vps/vps-nightly-backup.ps1](vps/vps-nightly-backup.ps1) | Runs on the VPS, once a night, as the scheduled task that Install-Backup.ps1 puts there. |
| [vps/vps-openssh.ps1](vps/vps-openssh.ps1) | Runs ON THE VPS, sent there by Upgrade-OpenSsh.ps1: puts Microsoft's OpenSSH for Windows 10.4 in place of the Windows Server 2022 one, so sshd offers a post-quantum key exchange, keeping the box's host keys, sshd_config and port 22 rules as they are. |
| [vps/vps-restore-services.ps1](vps/vps-restore-services.ps1) | Runs ON the VPS, sent there by Restore-Box.ps1: puts the site's, the bot's and Caddy's half of an unpacked nightly backup back into their folders. |
| [vps/vps-runner-logs.ps1](vps/vps-runner-logs.ps1) | Runs ON the VPS, once a day, as the scheduled task that Keep-RunnerLogs.ps1 -Install puts there (C:\Thornswood-Watch\runner-logs.ps1). |
| [vps/vps-say-staff.ps1](vps/vps-say-staff.ps1) | Puts one staff notice from an agent into the watchdog's outbox, alerts.jsonl, which the bot says in #staff-updates within a minute, or the watchdog through its #staff-updates webhook when the bot is down (#447). |
| [vps/vps-ssh-scope.ps1](vps/vps-ssh-scope.ps1) | Runs ON THE VPS, sent there by Set-SshScope.ps1: limits who may reach ssh on port 22 to a list of addresses, refusing a list that leaves out the machine running it, and arms a ten minute put back. |
| [vps/vps-syn-flood.ps1](vps/vps-syn-flood.ps1) | Measures the forged SYN flood on the box's port 443 (#2995) and what it costs the box, over a short window. |
| [vps/vps-time-wait.ps1](vps/vps-time-wait.ps1) | Runs ON the VPS, sent there by Set-TimeWait.ps1: holds a connection the box closed in TIME_WAIT for 30 seconds instead of Windows' 120, and restarts the box for it when asked and nobody is on either server. |
| [vps/vps-web-firewall.ps1](vps/vps-web-firewall.ps1) | Runs ON THE VPS, sent there by Set-WebFirewall.ps1: lets TCP 80 and 443 in only from Cloudflare's ranges, so a forged SYN from anywhere else gets no answer (#2995). -Open puts both back to any address. |
| [vps/Vps.ps1](vps/Vps.ps1) | The one place every script gets the VPS address, user, and ports from. |
| [vps/Watch-Load.ps1](vps/Watch-Load.ps1) | The website, the game server, the voice service and the bot share one five core box, and nothing kept a number for any of them. |
| [vps/Watch-Outside.ps1](vps/Watch-Outside.ps1) | Watches, from outside the VPS, the things the project needs that the VPS cannot watch for itself, and tells staff in Discord when one breaks and again when it is fixed. |
| [vps/Watch-Services.ps1](vps/Watch-Services.ps1) | Everything runs on one box now. The website, the game, the bot and the voice server are four things that can stop on their own, and nothing up there notices when one does. |
| [vps/Write-BotToken.ps1](vps/Write-BotToken.ps1) | The one writer of the Discord bot token. |
