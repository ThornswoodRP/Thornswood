# Critical JSON state and configuration

The JSON files Thornswood's release, deploy, game, site, bot and voice trust, who writes each one, who reads it, and how it is checked today. This is the inventory #2180 asks for. `scripts\release\RecordShape.ps1` holds eleven committed records to a shape and version, fail closed, and those rows are marked **held**; it also holds the feed's three files and each server's `server-settings.json`. The rest are listed so the next change can take them in order of risk. Nothing here changes a file's format: there is no migration.

`tests\test-4434-json-inventory.js` holds this page to the code (#4434): every JSON store the site and the bot keep is on it, with the site or the bot named as its writer exactly when that code writes it, and the count of held records is the checker's.

**How a check works.** `scripts\release\RecordShape.ps1` reads a record through `ConvertFrom-ThornswoodJson` (an empty or broken file names itself). It then refuses a version this checkout does not know, and refuses a missing or wrongly typed field the readers depend on. Records written before a version field existed are read as version 1. A file that says 2 is refused, not half understood. `scripts\release\Check-Records.ps1` runs this over the committed records, and `tests\test-record-shapes.ps1` holds it.

## Release and deploy records (repository)

| File | Written by | Read by | Risk | Check today |
| --- | --- | --- | --- | --- |
| `records/server-build.json` | New-ServerBuildRecord.ps1 (Build-Server) | Deploy-Server, Deploy-DevGamemode, Deploy-Gamemode, Export-ServerPayload, Publish-Server, Install-ThornswoodServer (on the box), ServerOrder, Check-ShipReady | High: every server deploy is held to it | **held** (sha256, bytes, source.commit, files map, lightPlugins) |
| `records/client-build.json` | New-ClientBuildRecord.ps1 | Ship, Sync-Client, Publish-Update, Build-Launcher (into the launcher), launcher ClientRuntime/OwnGame | High: every client and Ship is held to it | **held** (forkCommit, files map) |
| `records/client-licences.json` | New-ClientLicenceRecord.ps1 (engine.yml, from the fork build's measurement) | Source-Notice.ps1 (the notices Ship puts with the client, and Build-SetupFiles.ps1 with the installer), Publish-FridaSources.ps1, Check-Records | Medium: says which licence texts go with which client file (#3099) | **held** (forkCommit, files, ports with each text's sha256); Check-Records holds it to client-build's commit and each text in `records/client-licences` byte for byte |
| `records/front-build.json` | Build-Front.ps1 -Record (with the pin) | Build-Front.ps1, Go.ps1 (every Ship), Source-Notice.ps1 and Build-SetupFiles.ps1 (its packages' texts in `records/front-licences`, #3751) | High: every file under Data\Platform\UI that the front makes is held to it, and the npm packages in build.js with their licence texts (#2754) | **held** (forkCommit in full, files map) |
| `records/most-online.json` | by hand | MaxOnline.ps1 (Deploy-Gamemode, Deploy-DevGamemode, Publish-Server, Publish-Update, Install-Voice), site | High: the engine's seat count; over 1000 stops the server starting; voice under the seats keeps seated people out of voice and chat | **held** (people 1 to 1000, staffSeats, voice not under the seats; the same for its dev object) |
| `records/collection-plugins.json` | New-CollectionPluginRecord.ps1 | CollectionPlugins.ps1 (Deploy-Server, Deploy-DevGamemode -LoadOrder) | High: full deploys refuse on it (#2019) | **held** (version 1 required, plugins rows) |
| `records/skyrim-pin.json` | by hand | Publish-Update (into version.json), launcher Downgrade/Config | High: the pinned game build | **held** (build, appId, exe sizes, three depots as digit strings; Publish-Update keeps the feed's pin on a problem); Check-Records holds it to skyrim-files' build; test-skyrim-pin.ps1 (agreement) |
| `records/ui-gone.json` | by hand | Ship-Rules, Build-Launcher, launcher OwnGame | Medium: what every pack deletes | **held** (daedric name to sha256, unused names); Ship-Rules and Build-Launcher stop on a problem |
| `records/shipped-not-ours.json` | by hand, from a measurement (#1178) | Ship-Rules (Get-ShipShippedNotOurs), Publish-Update (into every record as gone) | Medium: what every install deletes where the bytes still match | **held** (version 1 required, files map of paths under Data with sha256 and bytes); Ship-Rules stops the release on a path that is not another author's; test-shipped-not-ours |
| `records/skyrim-files.json` | New-SkyrimFilesRecord.ps1 | Build-Launcher (into the launcher), launcher OwnGameKinds | Medium | **held** (build, appId, files with bytes, sha1, depot); Build-Launcher stops on a problem |
| `records/generated.json` | by hand | Build-Launcher (into the launcher), launcher GeneratedHere and GeneratedBuild, Build-Generated, Ship (its dry run) | Medium: every launcher builds from it before Play (#3715) | **held** (pandora.patches, bodyslide.sets, outfits and sliders); Build-Launcher and Generated.cs stop on a problem; test-build-generated |
| `records/steam-build.json` | Check-Outside.ps1 | Check-Outside.ps1 | Low | none |
| `records/update-creation-club.json` | Build-HarvestTable tooling | Build-HarvestTable, Build-HuntTable | Low (build time only) | none |
| `records/upstream-not-taken.json` | by hand | people | Low | none |
| `records/signing/metadata.json`, `signing.template.json` | by hand (`signing.json` is ignored by git) | Sign-Artifact, Ship, Setup-ShipMachine, Check-ShipReady | Medium: signing config, no secret in the repository | named on a bad read |

## Built and deployed state (machine or box)

| File | Written by | Read by | Risk | Check today |
| --- | --- | --- | --- | --- |
| `server-settings.json` (built, and on each server) | Deploy-Gamemode, Export-ServerPayload; ServerSettings.ps1 carries settings on the box | the engine, Deploy-Server, Deploy-DevGamemode, Swap (on the box), site | High: port, load order, seats | named on a local bad read (#2154); **held** on the box (`server-settings`, Swap and Install-ThornswoodServer, #2404) |
| `thornswood-build.json` (build stamp) | BuildStamp.ps1 | Deploy-Server, Deploy-DevGamemode, Publish-Server (held to the payload's gamemode, #459) | Medium | named on a bad read (#2154) |
| `deployed-build.json` | DeployedBuild.ps1 (on the box), from Deploy-Server and Publish-Server | site | Low | none |
| `version.json`, `published.json`, `releases.json` (feed store) | Publish-Update, Publish-Server, Rollback-Feed, Scrub-Feed, Dev-News, Set-Server, Set-Collection, Repair-Manifest, Remirror-Site-Feed | every launcher, site, the next Ship and rollback | High: what every launcher installs | **held** (`feed-version`, `feed-published`, `feed-releases`): Send-FeedStore, the one way they reach the VPS, refuses a file out of shape before anything goes up (#2180); `Check-Records -Feed` reads a store folder (#2420) |
| launcher `config.json` | launcher, Set-Server, Set-Collection | launcher, Deploy-Gamemode, Ship-Rules | Medium | named on a bad read; Deploy-Gamemode falls back |

## Site, bot and voice state (on the box)

The site's files are in its `data` folder unless the row names another. The bot is granted only `data\for-bot` (what the site leaves it) and `data\from-bot` (what it leaves the site) there, so a file of the site's own is never read by the bot. The bot's own files are in its data folder (`DATA_DIR`, `bot\bot_base.py`).

| File | Written by | Read by | Risk | Check today |
| --- | --- | --- | --- | --- |
| `bans.json`, `pk.json` | site | site (and what it hands the game server at join) | **Critical**: authorization | **held**: a file that is there and will not read, or is not a table, shuts the door and the join pass (bans #2186, pk #2180), is never written over, and `/api/ready` answers 503 naming it |
| `linked.json`, `sessions.json`, `signins.json` | site | site | High: identity and sign-in | **held** (#2180): never written over while it will not read; a broken `linked.json` also shuts the door and the join pass, since the site cannot tell who holds which character. The site logs NOT READY at start, `/api/ready` answers 503 naming each file, and Deploy-Docs asks it after every site deploy. The watchdog asks it every run and tells staff once when it fails, naming the file, and once when it reads again (#4448) |
| `rules-accepted.json` | site, from the answer an alpha application sends with its ticket | site | Medium: who agreed to the rules | its own: never written over while it will not read (`noteRules`, `site/lib/store.js`) |
| `signouts.json` | site | site | High: a sign out (#4405) | its own: a time per keyed account, never written over while it will not read, and while broken every staff sign in reads as signed out (`site/lib/auth.js`) |
| `notes.json` | site | site | Medium: concurrent edits (#2188) | none |
| `for-bot/inbox.json`, `for-bot/trouble.json` | site | site, bot (reports and Report a problem from the inbox, the staff channel's trouble posts) | Medium: concurrent edits (#2188) | none |
| `results.json` | site, from staff marking test results in the hub | site | Low | none |
| `roster.json` | site, from what each game server's gamemode sends (POST /api/roster) | site (and each person's characters at join) | Medium | none |
| `economy.json` | site, from each game server's hold economy count (POST /api/economy) | site (the hub's Hold economy page) | Low | none |
| `session-logs/<session>.json` | site, from the launcher at the end of a play session | site (the hub), Read-LauncherStarts.ps1 | Medium: kept 365 days by the file's time, then deleted (#4432) | none |
| `gallery.json`, `gallery-pending.json`, `gallery-reports.json`, `uploads/uploads.json` | site | site | Medium | none |
| `files/files.json` (the downloads list) | by hand on the box; nothing in the repository writes it since the installer moved to its GitHub Release (#4824) | site (`/file/` and the Downloads page) | Medium: what `/file/` serves (#3798) | none |
| `news.json` | the site (from the build Releases main has reached, #5801), Set-DevNews | site | Low | named on a bad read (#2119) |
| `public/page-versions.json` | by hand, committed | site | Low | `site\tests\test-page-changed.js` |
| `config.json` (the site's own folder) | by hand on the box; the site writes its secret and password into it once when they are missing | site | High: holds secrets, never in the repository | never written over while it will not read (`site/lib/config.js`) |
| `from-bot/lists.json` | bot (the known issues and roadmap it reads from GitHub) | site (its Known issues and Roadmap pages) | Low | none |
| `joins.json` | bot | bot, `bot\backfill.py`, `bot\redraw.py` | Medium: each member's join number | none |
| `open-tickets.json` | bot | bot | Medium | none |
| `commands-synced.json` | bot | bot | Low | none |
| `heartbeat.json` (the bot's data folder) | bot | Watch-Services.ps1 (the watchdog) | Medium: a bot that stops beating is said and restarted | none |
| `trouble-posts.json`, `news-said.json`, `restarts-said.json`, `staff-notices.json`, `problems-filed.json` | bot | bot | Low: what it has posted already, so nothing posts twice | none |
| `channel-setup.json`, `known-issues.json` | bot | bot | Low | none |
| `bot.env.json` | Install-Bot | bot | Medium; holds a secret and is never in the repository | none |
| `Thornswood-Admin/for-bot/github-token.json`, `Thornswood-Admin/for-site/github-token.json` | the box admin service (`scripts\vps\admin\admin.js`), every half hour (#5184) | bot (issues for #known-issues and Report a problem), site (its GitHub reads) | High: a GitHub token, never in the repository | each reader takes the token only while it has not ended |
| `deletion-requests.json` (the site's data, the bot's data, each voice service) | Delete-Person.ps1 | site, bot and voice at their next start, which apply it and delete it (#2758) | High: a person's data leaving | none |
| `online.json` | the gamemode (each game server) | site, Deploy-Server, Deploy-DevGamemode, vps-time-wait (on the box) | Medium | none |
| `thornswood-deploy.json` | Install-Bot, Install-Voice, Deploy-Server, Deploy-DevGamemode, Publish-Server (Artifact.ps1) | site, game servers, Publish-Server -PutBack | Low | a put-back holds it to the gamemode it came back with (#459) |

## Version changes and rollback (#2180, #2176)

How each kind of JSON state takes a format change today, and how it is put back. This is the design #2180 asks for before any data change, and the versioning, atomic write and locking comparison #2176 asks for. Nothing here changes a file or a script.

### What a version change does today

- **Held records** (the eleven committed records in `scripts\release\RecordShape.ps1`): each kind lists the versions this checkout understands, and every one is `@(1)` today. `collection-plugins.json` and `shipped-not-ours.json` must say their version (`MustSay`); the other nine predate a version field and are read as version 1 when it is missing. A record that says a version the checkout does not list is refused with "update the checkout, or the record came from somewhere else". So a version 2 is a two-step change: first a checkout that lists both 1 and 2 goes out, then a writer starts writing 2. Going back is the same steps in reverse.
- **Committed records with no check** (`steam-build.json`, `update-creation-club.json`, `upstream-not-taken.json`): no version field and no check. A format change is whatever the writer and reader agree on in the same commit.
- **Built and deployed state, site, bot and voice state**: no version field anywhere. Readers take what is there; a file that will not parse is named on a bad read where the table above says so, and on the site falls back to its empty default (`jsonFile` in `site/server.js` logs it), except the five held site files above, which are never taken as empty.

### How each is put back

| State | Rollback today |
| --- | --- |
| Committed records (`records/*.json`) | Git: revert the commit that changed the record. The writers (New-ServerBuildRecord, New-ClientBuildRecord, New-SkyrimFilesRecord) overwrite the file in the working tree, so an unwanted rewrite is undone with git before it is committed. |
| `version.json`, `published.json` (feed store) | `Rollback-Feed.ps1` (#442): the feed keeps the last thirty release records, and a rollback builds one ordinary pack from the difference between the current release's record and the one asked for, put on the end of the feed. Putting the channel forward again is the same command pointed at the later release. |
| Server and service files on the VPS, including `server-settings.json` and the build stamp | `Swap.ps1` (#446): the new files go into `.stage-<stamp>` and are checked there; what they replace goes into `.prev-<stamp>`. A failed rename or a server that does not answer puts the old files back by itself (SWAP ROLLED BACK); `-PutBack` puts the newest `.prev` folder back later, and the record that came back with it is restored. |
| Site documents (`.md` through `writeDoc`) | One `.bak` copy of the previous text, taken before each write. |
| Site, bot and voice JSON | No kept copy. A bad write or a bad value is put back by hand or from a box backup. |

### Versioning, atomic writes and locking, compared

| Where | Versioning | Atomic write | Locking or clash check |
| --- | --- | --- | --- |
| Held records | Version list per kind in RecordShape.ps1; unknown version refused | No: `[IO.File]::WriteAllText` straight onto the file. A torn write is caught by the next read (`ConvertFrom-ThornswoodJson` names the file) and git holds the last good copy | None needed: one writer, on one machine, then a commit |
| `version.json`, `published.json` | None | No: `WriteAllText` on the local copy | Yes, a compare before writing (#907): Publish-Update asks the VPS for both again before editing the feed. A changed `published.json` stops the release with nothing written; a changed `version.json` is received again and this release goes on top. The send checks the same two again |
| `deployed-build.json` | None | Yes: temp file then `Move-Item -Force` (DeployedBuild.ps1) | None |
| `thornswood-build.json` | None | No: `WriteAllText` (BuildStamp.ps1); on the box it travels inside the swap | Covered by the swap |
| Site JSON through `putJson` | None | Yes: same-folder temp file then rename, with a copy-then-delete fallback where Windows refuses the rename | One Node process, synchronous read and write |
| Site JSON written directly (the launcher session log files, the site's own `config.json`) | None | No: `fs.writeFileSync` straight onto the file | None |

### Options for the next change, and the do-nothing case

- **Do nothing.** Held records already refuse a version they do not know, the feed and the VPS already have a tested way back, and the site's main write path is already temp then rename. What stays open is that the site files not held yet still read a malformed file as empty.
- **Version field on the site's critical files.** The same rule as RecordShape: missing means 1, unknown means refuse at startup. Rollback is the reverse two-step above. It needs a readiness signal so a refused start is seen (slice 4).
- **Atomic writes for the record writers.** Temp then move, as DeployedBuild.ps1 already does. Low risk; it only matters for a crash mid-write, which git already covers for committed records.
- **More clash checks.** Extend the board's revision idea to the other files #2188 names (`notes.json`, `inbox.json`, `open-tickets.json`, `trouble.json`). A file lock is not needed while one Node process writes them.
## Next slices, in order

Done: the box-side reads (#2404), the feed store's contracts (#2420) and holding every feed send to them (#2180), `bans.json` failing closed (#2186), and `pk.json`, `linked.json`, `sessions.json` and `signins.json` held with a readiness signal, `/api/ready` (#2180).

No slice of #2180 is left. What the options above name (a version field on the site's files, atomic writes for the record writers, more clash checks) is a change of its own, taken only when a format change needs it.
