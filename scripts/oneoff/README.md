# scripts/oneoff

Scripts that did one job once, kept rather than deleted. Nothing in the
repository calls any of them, and none of them is part of a release, a deploy
or a test. They were parked here on 25 September from `tools\`, after the
audit of that day found nothing still using them.

They were written to sit in `tools\`, which is gone since 29 September, and
some of them reach the scripts beside them from there, so a script taken out to
run again needs its paths pointed at `scripts\<area>` first. Most of them were written for the old layout (the old build folder, the
build before the own game folder) and would do the wrong thing on a machine
set up today. Read the header before running anything.

| Script | What it did | Why it is here |
| --- | --- | --- |
| `Add-SkyrimUnbound.ps1` | Installed Skyrim Unbound Reborn into the old build and published. | The collection installs Unbound now. **It refuses to run** (#1179). |
| `Run-Everything.ps1` | Ran the old Add-* installers in one go and published once. | The collection installs the mods now. **It refuses to run** (#1179). |
| `Fix-Voice.ps1` | Got the voice service running on the VPS on 13 September. | `Install-Voice.ps1` does that job, and takes off the boot task this one left, which started voice with no auth. **It refuses to run** (#2008). |
| `Check-RosterScript.ps1` | Parsed the roster script before it was sent. | Named a path on one machine; `Check-Roster.ps1` is the live one. |
| `Add-TempleRespawn.ps1` | Installed Respawn - Death Overhaul. | That mod is out (the known issues page). **It refuses to run.** It throws at the top rather than putting a plugin back that no live load order carries. |
| `Add-JContainers.ps1` | Installed JContainers for SunHelm's meters. | SunHelm is out. |
| `Remove-FomodLeftovers.ps1` | Cleaned up after the 13 September body mod install. | Done. |
| `Fix-PluginProblems.ps1` | Removed CFTO-JK-Patch.esp and RaceMenuPlugin.esp. | **Do not run it.** The JK's patch went into the collection on 15 September, so this would now take out a plugin that belongs. **It refuses to run** (#1179). |
| `Install-Emotes.ps1` | Copied the emote wheel from `tools\emotes` into a game folder. | The wheel is `game\plugins` and `game\ui` now, and `Go.ps1` installs it; the copies it read were 13 September's and are deleted. |
| `Revert.ps1` | Put one day's game folder back after MCMHelper.esp shifted the load order. | Done, and it read the same deleted copies. |
| `Undo-DiscordBuild.ps1` | Reverses, from Discord's audit log, what the bot changed when Setup-Discord.ps1 was run on 25 September only to make a webhook that already existed. | Made on 25 September to be run once; it lists first and changes nothing without `-Apply`. |
| `Reset-History.ps1` | Replaces the repository's history with one commit of main's files, keeps the hotfix branch live was built from, deletes the other branches, and saves the old history to a bundle first (issue #567). | Made on 25 September to be run once, by Patrick; `-DryRun` first. `tests\test-reset-history.ps1` runs it against a scratch repository. |
| `Copy-ReleaseAssets-ToSite.ps1` | Copies every download both live feeds name from Thornswood-Releases to the site's `/feed[-dev]/assets/<sha256>`, checking each against the feed's sha256, so updates come from thornswood.net (issue #897). | Made on 28 September to be run once, by Patrick; `-Check` first. It never writes a version.json: the next Ship on each channel, or `Repair-Manifest.ps1 -MoveToSite` and the remirror, moves the urls. `site\tests\test-site-assets.ps1` runs it against a local copy of the site. |
| `Move-FeedStore-ToVps.ps1` | Copies each channel's release baseline (`published.json`) and every launcher version its history named from the Thornswood-Releases clones to the VPS store beside the feed (`C:\Thornswood-Docs\feed` and `feed-dev`), reads them back byte for byte, and saves the whole repository as a git bundle under `%LOCALAPPDATA%\Thornswood\feed`, so Thornswood-Releases can be deleted (issue #907). | Made on 28 September to be run once, by Patrick, after the last Ship made with the clone-based scripts; `-Check` first. It refuses when the site's feed is not the clone's, the clone has anything uncommitted or unpushed, or the VPS already holds a different baseline. It never writes a clone or a version.json. `tests\test-feed-store.ps1` runs it against scratch clones. |
| `Move-LightFormIds.ps1` | Moves the light plugin form ids a world stored under each client's own light order (the head parts measured in docs\LIGHT-ORDER-DRIFT.md) to the server's light order, by plugin and local id (issue #1715). | Made on 5 October to be run once, by Patrick, on a copy of each world taken with its server stopped, after the engine that loads light plugins is deployed; a dry run first, `-Write` keeps every record it changes as it was. It refuses a server's own folder and moves only the ids its plan lists, so a second run moves nothing twice. `tests\test-move-light-form-ids.ps1` runs it on scratch copies. |
| `make-join-card.py` | Builds `bot/assets/join-card.png` from `bot/invite-splash-1920x1080.jpg`. | One-shot art generator; was parked in `bot/` and moved here so bot sweeps do not treat it as runtime. |
| `GourmetFishingVanilla.pas` | The xEdit script that repointed Gourmet's fishing ingredients at vanilla ones (docs\GOURMET-FISHING-PATCH.md). | Applied once; the patched plugin is what ships. |
