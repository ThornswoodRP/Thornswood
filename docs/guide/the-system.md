# How the system fits together

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

How the pieces fit together. The pages from Set up a machine to Release to main are the path. The letters in [The tools, A to O](tools.md) are the tools.

## What Thornswood is

Thornswood is a modded co-op Skyrim roleplay server on SkyMP, the server
authoritative multiplayer for Skyrim Special Edition. It is Patrick's, in an
alpha that is open by application, becoming an RP server of its own,
less strict than the big ones, with working NPCs, its own launcher, its own
website and Discord, and a lore of its own (fifty years after the civil war,
the Stormcloaks won, a High King over the Jarls, the Thalmor expelled, the
Empire back under a trade treaty with one embassy). Characters live on the
server, not in save files. During the playtest they are throwaway.

The words we use, and the rule that every change ships as one complete
release, launcher, game files and server together, are in How work moves.

## The pieces

| Piece | Where | What it is |
| --- | --- | --- |
| Source repo | github.com/ThornswoodRP/Thornswood (private), clone at `C:\Users\<you>\Downloads\Thornswood-Repo` | Launcher source, plugins, site, bot, every script |
| Feed store | On the VPS beside the feed the site serves: `C:\Thornswood-Docs\feed\{version.json, published.json, launchers.txt, history\}` and the same under `feed-dev`. Each machine's working copy is `%LOCALAPPDATA%\Thornswood\feed\main` and `\dev` | `version.json` (the feed, served at `/feed[-dev]/version.json`), `published.json` (the pack baseline), every launcher version the channel published, and each replaced file, none of those three served. Ship receives and sends them through `scripts\release\Feed-Store.ps1` (#907). Until then they were the `Thornswood-Releases` GitHub repository and its two clones |
| Downloads | On the VPS, `C:\Thornswood-Docs\feed\assets` and `feed-dev\assets`, served at `https://thornswood.net/feed[-dev]/assets/<sha256>` | Every pack, launcher exe and client runtime a feed names, one file per sha256, one folder per channel (`docs\FEED.md` "Downloads come from the site") |
| Launcher | `launcher\app\*.cs` + `launcher\app\*.axaml`, published by `scripts\release\Build-Launcher.ps1` with `dotnet publish` (Native AOT) from `launcher\app\Thornswood.csproj` (#4823) | Avalonia app, installed by Velopack, at `<drive>:\Thornswood\Launcher\Thornswood.exe` (C: on most machines); profile, config and packs under that folder. The scripts find the install on whichever fixed drive holds it; `-Root` overrides |
| Dev build | `<drive>:\Thornswood-DevBuild`, beside the main install, put there by the main launcher's Play page Server dropdown | Same exe, `config.json` says `Channel: dev`, `UpdateBranch: dev`, port 7787, voice 7789. Staff roles only (Owner, Dev, Gamemaster, Moderator, Loremaster) |
| Game | `<Root>\Game`, Thornswood's own folder, which the launcher builds from the Steam copy of Skyrim Special Edition and what Vortex deployed from the Nexus collection (see One Skyrim of its own) | The launcher will not Play from the Steam copy itself. Thornswood's own loose files live in `Data\Platform` (plugins in `Plugins\thornswood-*.js`, page in `UI\`) and `Data\SKSE\Plugins\Thornswood.ini` |
| Plugins | `game\plugins\thornswood-{front,emotes,mark,voice}.js`, UI in `game\ui` | Skyrim Platform JavaScript. Idle unless the client points at our server and the launcher left a fresh session note |
| Game server | VPS play.thornswood.net, `C:\Thornswood-Server`, UDP/TCP 7777, resources 3000, task `Thornswood Server` | skymp5-server with `gamemode.js`; the door reads its allowed list from the site |
| Dev game server | `C:\Thornswood-Server-Dev`, 7787, resources 7788, task `Thornswood Dev Server` | Same binaries, fresh world, door list is the staff roles only (`https://thornswood.net/dev`) |
| Voice | `C:\Thornswood-Voice` 7778 and `C:\Thornswood-Voice-Dev` 7789 | node, `voice\voice-server.js`; the launcher holds the microphone, the game plugin relays state through files in `Data\Platform` |
| Site | `site`, on the VPS at `C:\Thornswood-Docs`, node on 127.0.0.1:3001 behind Caddy, https://thornswood.net | Public pages from `data\site\*.md`, admin hub, Discord login, the door API, uploads, news |
| Bot | `bot`, on the VPS at `C:\Thornswood-Bot`, the Windows service `ThornswoodBot` under its own account, `NT SERVICE\ThornswoodBot` | discord.py: tickets, join cards, staff tools |
| Watchdog | `C:\Thornswood-Watch\watch.ps1`, every five minutes | Restarts any service that stops answering, three tries an hour, and tells #staff-updates (the id in `bot\staff-channel.txt`) once when anything dies and once when it is back: the servers, voice, the site, the bot, the nightly backup, the build runner and the disk. Through the bot, or its own webhook when the bot is down. A server stopped on purpose is held (`C:\Thornswood-Watch\holds`, #5155): left alone until its hold runs out, 30 minutes unless the stop says, 2 hours at most, then told once and started. Every script that stops a server writes and removes its own hold; a stop by hand in a run note is held with `.\scripts\vps\Hold-Server.ps1 -Service <name> -Why "<why>"` first and `-Clear` after, or from a cloud thread `pwsh scripts/vps/Box-Run.ps1 -Line 'Hold-Server -Service <name> -Why "<why>"'`. Its install is the gate verb `Watch-Services -Install` |

The server's SkyMP fork is on GitHub (github.com/ThornswoodRP/skymp, branch
`thornswood/engine-changes`), so its source survives any one machine, and since
25 September it is the `engine\skymp` submodule of this repository, pinned to
the commit the build records name: `git submodule update --init engine/skymp`
fetches it into the repository folder. It is large and needs Visual Studio to
build, so a machine that only copies server binaries can leave it unfetched.
Its configured build tree and toolchain (`engine\skymp\build`) are on
Patrick's machine alone for now. The release output is `out` in the repository
folder, ignored by git. `scripts\release\Where.ps1` says where each of these is on the
machine it runs on.

What one machine keeps and git never sees has a home of its own since
29 September (issue #440, phase 10), when the last of it left `tools\` and that
folder went:

| File | Where | What it is | Read by |
| --- | --- | --- | --- |
| `signing.json` | `records\signing` | Whether this machine signs, and with what. No key in it | Sign-Artifact, Ship, Setup-ShipMachine |
| `thornswood-front.zip` | `local` | The front build, made outside the repository | Go |
| `mod-audit.json` | `local` | What Audit-Mods found last time | Audit-Mods |
| `backups` | `local` | The backups brought off the VPS, since 5 Oct (`Downloads\Thornswood-Backups` before). Secrets are inside them | Fetch-Backups, Backup-Server, Clean-Everything |
| `release-devbuild` | `local`, on One | The folder One's dev release is built from, since 5 Oct, recorded by Setup-ShipMachine -Root | Ship, Check-ShipReady, Build-Generated -DryRun |
| `backup-key.txt` | `local` | A copy of the backup passphrase, a secret. Documents is where it really lives | Restore-Backup | Who holds each thing Thornswood cannot run without, and who the
second holder is, is `docs\OWNERSHIP.md` in the private ops repo.

## One Skyrim of its own

Thornswood runs from its own game folder, `<Root>\Game`, and nothing here
supports another server's install. Decided by Patrick on 20 September, after
measuring what the old sharing code had actually let through: the SkyMP client
runtime in Thornswood's folder, the bundle, `MpClientPlugin.dll`, both
SkyrimPlatform DLLs, the CEF host and `TESModPlatform.pex`, were all another
launcher's builds, copied across from the Steam copy on every rebuild and then
patched by text. None of them had come from Vortex and none had come from
here.

**The folder.** The launcher makes `<Root>\Game` itself (`launcher\app\OwnGame.cs`,
Settings, Maintenance, "Thornswood's own Skyrim folder"). With the Thornswood
profile deployed in Vortex, it builds the folder from that deployment, then
restarts and runs from it. `Paths.Init` prefers `<Root>\Game` over the Steam
copy, so from then on the launcher points Windows' Skyrim settings, plugin list
and saves at `Profile` for each session and ignores which profile Vortex has
on. When Vortex deploys a newer Thornswood collection, the next launcher start
brings it in by itself. The offer to make the folder is made at startup
whenever it is possible; it used to wait for another server's files to be
found, and no longer looks for any.

**When Vortex deploys somewhere else.** Vortex can manage a Skyrim that is not
the Steam copy: on 24 September a tester's Vortex deployed the collection into
another SkyMP server's copy of the game, a folder of its own under `steamapps\common`. The
launcher finds that folder by itself (`OwnGame.DeploysInto`: any folder
directly under a Steam library's `steamapps\common` with `SkyrimSE.exe` and
`Data\vortex.deployment.json`, a Steam copy of Skyrim Special Edition first,
otherwise the newest record). `VortexGame` in config.json wins over the search;
Fix and Settings' Choose Vortex's folder set it. Scan names the folder and Fix
points the launcher at it. Nothing of that folder's own reaches `<Root>\Game`:
the game itself comes from the Steam copy (`OwnGame.Source`, the one Downgrade
keeps on the server's build), and the mods are exactly the files Vortex's
records in that folder list, linked or copied from Vortex's staging folder.
With no Steam copy on the machine the folder is not made.
`launcher\tests\test-vortex-folder.ps1` proves it.

**The client.** The SkyMP client runtime is built from the fork, the
`engine\skymp` submodule on `thornswood/engine-changes`: `npx webpack` in
`skymp5-client` for the bundle and the native build for the rest. After a
rebuild, `scripts\release\New-ClientBuildRecord.ps1` records the six files that build
produces which differ from upstream, by hash, against the fork commit, into
`records\client-build.json`. `scripts\release\Sync-Client.ps1` copies those six from the
build output into the game folder and refuses any file that is not the
recorded one; `Go.ps1` runs it beside the overlays and the plugins. Ship runs
`Sync-Client.ps1 -Check` and refuses a release whose client is not the recorded
build. Ship never builds the engine: when the game folder already holds all
six as recorded, Sync-Client copies nothing and does not need the build, so a
checkout with no `engine\skymp` (a fresh Ship worktree) can still Ship, and
`Check-ShipReady.ps1` does not ask for the fork (issue #946). `OwnGame.Foreign` never takes those six paths from the Steam copy. The
launcher's Client row on the Play page compares all six with the same record
(`ClientRuntime`), and `ClientRuntime.Heal` puts back any that is missing or
not the recorded build.
`Ship-Rules.ps1` counts one of them as ours, for a pack, only when its sha256
is the recorded one.

**Links, not copies.** Big files (archives, textures, meshes, plugins) are hard
links to Vortex's copies, so a collection is not on the disk twice; this needs
the folders on the same drive as the Skyrim Vortex deploys into. When they are
not on one drive the folder cannot be made, and `OwnGame.OneDriveOnly` says so
by naming both ways out and their paths: install Thornswood on Skyrim's drive,
which lands in `<drive>\Thornswood`, or move the Steam library to Thornswood's
drive in Steam, Settings, Storage. A hard link is the same file under a second
name, so anything written into one in place lands
in every folder that links it. So these are always copied: the game's root
files, `Data\Platform`, `Data\NirnLabUIPlatform`, `Data\SKSE`, `Data\MCM`,
`Data\Video`, settings, script and program files, and the vanilla masters. The
launcher's own writes into the game folder go through `OwnGame.Unshare` or
`OwnGame.Separate` first.

**Left out of the folder, and of every pack and installer:** decided by what
belongs, never by whose a file is. `OwnGame.Foreign` in the launcher and
`Test-ShipOtherServer` in `scripts\release\Ship-Rules.ps1` are the same list; change both
together. In `Data\Platform\Plugins` only `thornswood-*.js` and the recorded
bundle belong; in `Data\Platform\UI` only `index.html`, `build.js` and
`thornswood-*.js`; `PluginsNoLoad` is sign-in data with a token in it and never
travels; NirnLab UI Platform is left out because SkyrimPlatform will not start
on its own browser with it present. Vortex's records and markers, logs and
`Claude outputs` are left out too.

**In the folder while the game runs.** Keep puts back every file our own
updates wrote under `Data\Platform` before Play and parks any `.js` in
`Plugins` that is not ours in `Profile\Parked`, then puts them back the moment
the game closes. Hold keeps its own files open read only while the game runs,
so nothing can swap them under Skyrim Platform's hot reload. Every Thornswood
plugin idles unless the client settings point at our server and the launcher
left a fresh session note, `Data\Platform\thornswood-session.txt`. No wrapper
script is needed around the launcher for any of this.

A Skyrim on a newer build than 1.6.1170 gets a Downgrade button on the Play
page (Downgrade.cs): the launcher opens Steam's console, types the three
`download_depot` commands itself, watches Steam's content_log.txt for each
depot to finish, copies the 1.6.1170 files over the Steam copy and removes the
downloads. Nothing is typed unless Steam's window is confirmed in front; if it
cannot be, the command goes on the clipboard and the log says where to paste.

**Records.** `Profile\OwnGame\files.txt` lists each file brought in, whether it
was linked or copied and whether Vortex deployed it. Ship-Rules.ps1 reads that
list (`Get-ShipOwnGameCollection`) so Publish-Update keeps the collection out
of packs, exactly as it reads `vortex.deployment.json` when the game is the
Steam copy, and refuses to go on if the list is empty. `Profile\OwnGame\plugins.txt` and `loadorder.txt` are
the Vortex profile's lists as of the folder's last update, and are the
reference load order a release carries (`Get-ShipLoadOrderDir`). Ship checks
the client in `<Root>\Game` against `records\client-build.json`.

**The behavior files and the bodies, built on each computer.** The behavior
files (the animations for the mod list, Nemesis' output until 29 September)
and the bodies BodySlide builds are other people's work: Precision's and True
Directional Movement's patches merged into the game's graphs, and CBBE 3BA's,
CBBE's and HIMBO's bodies. Decided by Patrick on 27 October (issue #3715,
changing #1247): every launcher builds them in its own folder before Play,
and no release or installer carries them. Before that a step on the shipping
machine built them and every release shipped them. They are never built in
the Steam copy, which stays the person's own.

The launcher's Play runs `GeneratedHere.Ensure` (launcher\app\GeneratedHere.cs)
when `Profile\OwnGame\generated.txt` is missing or stale, and Fix offers the
same build as a card. A failed build or a body that is not covered stops
Play with a message saying why. `scripts\mods\Build-Generated.ps1` runs the
same code (`launcher\app\GeneratedBuild.cs`, compiled by
`scripts\mods\Generated.ps1`), so a developer can build or check a folder by
hand. With the game and the launcher closed:

```
.\scripts\mods\Build-Generated.ps1 -Root <a Thornswood install> -NoPause
```

The build runs two tools the collection installs, with what
`records\generated.json` names. The behavior files come from Pandora
Behaviour Engine+ (Nexus 133232, in the collection from revision 2), with
exactly the four patches the list names and every other patch off. Nemesis
cannot do it: its `-generate` never starts its work (in its own source, the
command line connects to a slot that does not exist), which is why it leaves
the collection in the same revision. Pandora's output for the current mod
list was compared with Nemesis' on 29 September: the same 20 behavior and
character files with the same names in them. The build runs a copy of
Pandora in its work folder, with a `Settings.json` beside it naming only that
folder's Data and a work output folder: Pandora 4.4.0 ignores `-o` and
without that file would take the registry's Skyrim, the Steam copy. It
refuses if Pandora changed anything in the game folder or its log has an
error, and needs the .NET 10 runtime on the machine. The bodies come from
BodySlide's sets (the women's 3BA NeverNude body and the men's HIMBO body
with boxers, issue #405). Each body is built at its set's own slider defaults
and never with RaceMenu morph files; it refuses a set or a slider move that
would shape the breasts, the seat, the genitals or the nipples (issue #1004)
or take the underwear off, and reads every body in the folder
(`launcher\app\CoveredBodies.cs`, which `Check-CoveredBodies.ps1` runs too)
before the record is written. First it gives the folder its own copy of every
file BodySlide writes in place, because the folder is mostly hard links to
Vortex's copies and a write through one lands in Vortex's copy and the Steam
copy too; it refuses, and records nothing, if a tool wrote through a link
anyway. A tool that sits using no processor time and writing nothing for
three minutes is stopped. It refuses while Skyrim or a launcher runs from
that install, and in any folder Vortex deploys into. `-DryRun` checks all of
it and changes nothing. What it made goes in `Profile\OwnGame\generated.txt`,
with a sha256 each and what it was built from: the launcher keeps those files
as Thornswood's through every refresh (`OwnGameKinds.cs`). The record is
stale when the mod list, a file either tool reads, `records\generated.json`
or a built file changed since, and the next Play builds them again.

`Ship-Rules.ps1` names the built files (`Test-ShipGenerated`) as machine
files: never packed, never in the installer and never listed as removed, so
no update deletes what an install built. Ship's "Animation and body files"
step runs `Build-Generated.ps1 -DryRun` on the ship root and stops both
channels when the collection installed there could not build them.

**The folder a release is built from (issue #2019).** Each channel's ship root
(`Where.ps1 ShipRoot` and `ShipRootDev`, recorded by `Setup-ShipMachine.ps1
-Root`) is a launcher install whose launcher is never started: Patrick's own
installs stay apart from the build folders, so he has the same files as
everybody else. So every Ship first runs `scripts\release\Update-ShipRoot.ps1`,
which builds `Thornswood-ShipRoot.exe` from `scripts\release\ShipRoot`
(OwnGame and the launcher files it calls, none of the window's, built
with the .NET 10 SDK and its own entry point, so OwnGame has one
implementation) and runs OwnGame's own Make or Refresh on the root: a new root
takes Thornswood's own files of the channel's release from its feed, as an
install does, and a root made at older rules or from another folder is brought
up to date with Vortex's deployment. Then the recorded client goes in from the
engine build (`engine\README.md` "One engine"), and the Ship stops with a
sentence, before anything is built or published, when either step cannot be
done. Main has its own root (`local\release-main` on One), so no Ship packs
`C:\Thornswood`. Nothing is built in a ship root for a release: the
animation and body files are every launcher's own (#3715).
`tests\test-2019-ship-roots.ps1` holds it.

A new root takes the game's own files from the Steam copy only when that copy
is on 1.6.1170, and an install's other way, the Downgrade, is a Steam
download under the person's own account that a script cannot run. One's
Steam copy is not on it since 16 Oct (another `bink2w64.dll` and
`Dawnguard.esm`, and the Anniversary Edition's Creation Club files), so
`-SkyrimFrom` on `Setup-ShipMachine.ps1` or `Update-ShipRoot.ps1` names a
folder that holds them, such as the other root's `Game` (#2603):

```
.\scripts\release\Setup-ShipMachine.ps1 -Channel main -Root C:\Thornswood-Repo\local\release-main -SkyrimFrom C:\Thornswood-Repo\local\release-devbuild\Game
```

Every one of the game's own files the new folder takes is checked against
`records\skyrim-files.json` by size and SHA-1, the archives too, before
anything is placed, and the root is not made when one is missing or
different; the sentence names it. They are copied, never linked, so the two
roots share no file, and Make stops if one of them changed while it worked.
`made.txt` names the folder on its `skyrim=` line. Only the ship root tool
does this: an install's way to 1.6.1170's own files stays the Downgrade.

**The Skyrim build.** Steam updates the Steam copy by itself. With Thornswood's
own folder, the Downgrade button works on the Steam copy the folder is made
from, never on the folder's copies, and the folder is then brought up to date
from it. Until the Steam copy is back on 1.6.1170 the folder is not made or
refreshed, so Thornswood keeps playing on the build it has, and the card above
Play says the Steam copy is on the wrong build. Files a mod replaces are left as
the mod has them. The sign in file the 16 Sep installer carried is removed from
the Steam copy as well as from the folder (`Leaks.cs`).

**Testing it on the dev channel.** The dev build runs from
`<Root>-DevBuild`, which has no Game folder when it is first installed. It
offers to make `<Root>-DevBuild\Game` the same way at its first start, its own
Settings, Maintenance has "Make it", and until the folder is there Play will
not start the game out of the Steam copy.

Skyrim reads its plugin list from one Windows folder per user. Thornswood swaps
it per session and ignores which profile Vortex has on.

## Where things are written down

- This guide. The index, [Developer-Guide.md](../../Developer-Guide.md), is the way in. `CLAUDE.md` in the private ops repo: what applies to a
  Claude on top of these rules. The To Do board,
  https://github.com/orgs/ThornswoodRP/projects/1: all outstanding work.
- `README.md`: what the repo is and where to start. A customer's install is
  the site's join page, `site\data\site\join.md`; setting up a
  developer's machine is [Setting up a machine](set-up-a-machine.md#setting-up-a-machine).
- `launcher\app\ARCHITECTURE.md`: how the launcher starts, what each class owns
  on disk, and every step between pressing Play and the game starting.
- `docs\MOVING-THE-SERVER.md` (in the private ops repo), `docs\COLLECTION-METHOD.md`: the VPS and the
  mod collection.
- `docs\OWNERSHIP.md` (in the private ops repo): who holds each credential, account and build, and who
  the second holder is.
- `lore\`: history and the Accord. `site\data\site\*.md`: the public
  pages (join, rules, classes, world, credits, privacy, terms), also live on
  the site.
- The site's hub boards (Active Issues, Test These, Suggestions, Archive, the
  Patrick runbook) are older than the board and are being retired (issue
  #433); where they disagree with the board, the board is right. The
  public Known Issues page and roadmap are not boards: the bot writes both
  from the issue board into the site's `data\from-bot\lists.json`, the
  known list from the `Known issue:` comments on the findings and the
  roadmap from the `roadmap:` labels and `Roadmap:` comments, and `/known`
  and `/roadmap` show that file (issue #3140; bot README, "The site's known
  issues and roadmap"). Change their words on the issue, never in a site
  file.
- `docs\archive` (in the private ops repo): dated snapshots (HANDOFF, the 17 September audit,
  WORKING-NOTES and the old To Do List), history only.
