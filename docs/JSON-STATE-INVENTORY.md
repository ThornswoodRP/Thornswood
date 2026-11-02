# Critical JSON state and configuration

The JSON files Thornswood's release, deploy, game, site, bot and voice trust, who writes each one, who reads it, and how it is checked today. This is the inventory #2180 asks for. The first slice also adds fail-closed shape and version checks for the records marked **held** (four in the first slice, four more in the third). The rest are listed so the next slices can take them in order of risk. Nothing here changes a file's format: there is no migration.

**How a check works.** `scripts\release\RecordShape.ps1` reads a record through `ConvertFrom-ThornswoodJson` (an empty or broken file names itself). It then refuses a version this checkout does not know, and refuses a missing or wrongly typed field the readers depend on. Records written before a version field existed are read as version 1. A file that says 2 is refused, not half understood. `scripts\release\Check-Records.ps1` runs this over the committed records, and `tests\test-record-shapes.ps1` holds it.

## Release and deploy records (repository)

| File | Written by | Read by | Risk | Check today |
| --- | --- | --- | --- | --- |
| `records/server-build.json` | New-ServerBuildRecord.ps1 (Build-Server) | Deploy-Server, Deploy-DevGamemode, Deploy-Gamemode, Export-ServerPayload, Publish-Server, Install-ThornswoodServer (on the box), ServerOrder, Check-ShipReady | High: every server deploy is held to it | **held** (sha256, bytes, source.commit, files map, lightPlugins) |
| `records/client-build.json` | New-ClientBuildRecord.ps1 | Ship, Sync-Client, Publish-Update, Build-Launcher (into the launcher), launcher ClientRuntime/OwnGame | High: every client and Ship is held to it | **held** (forkCommit, files map) |
| `records/client-licences.json` | New-ClientLicenceRecord.ps1 (engine.yml, from the fork build's measurement) | the pin pull request; the downloads and installer once #3099's second half lands | Medium: says which licence texts go with which client file (#3099) | written with each text's sha256; not yet read |
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

| File | Written by | Read by | Risk | Check today |
| --- | --- | --- | --- | --- |
| `bans.json`, `pk.json` | site | site (and what it hands the game server at join) | **Critical**: authorization | **held**: a file that is there and will not read, or is not a table, shuts the door and the join pass (bans #2186, pk #2180), is never written over, and `/api/ready` answers 503 naming it |
| `linked.json`, `sessions.json`, `signins.json` | site | site, bot | High: identity and sign-in | **held** (#2180): never written over while it will not read; a broken `linked.json` also shuts the door and the join pass, since the site cannot tell who holds which character. The site logs NOT READY at start, `/api/ready` answers 503 naming each file, and Deploy-Docs asks it after every site deploy |
| `rules-accepted.json` | site | site, bot | Medium: sign-in | none |
| `board.json`, `notes.json`, `inbox.json`, `open-tickets.json`, `trouble.json` | site | site | Medium: concurrent edits (#2188) | none |
| `gallery.json`, `gallery-pending.json`, `gallery-reports.json`, `uploads.json`, `files.json` | site | site | Medium | none |
| `news.json`, `page-versions.json` | the site (news.json from the main feed, #5187), Set-DevNews | site | Low | named on a bad read (#2119) |
| `online.json`, `roster.json`, `heartbeat.json` | game server, gamemode | site, launcher, Deploy-Server (on the box) | Medium | none |
| `joins.json`, `commands-synced.json`, `bot.env.json` | bot, Install-Bot | bot | Medium; `bot.env.json` holds a secret and is never in the repository | none |
| `thornswood-deploy.json` | Install-Bot, Install-Voice, Deploy-Server, Deploy-DevGamemode, Publish-Server (Artifact.ps1) | site, game servers, Publish-Server -PutBack | Low | a put-back holds it to the gamemode it came back with (#459) |

## Version changes and rollback (#2180, #2176)

How each kind of JSON state takes a format change today, and how it is put back. This is the design #2180 asks for before any data change, and the versioning, atomic write and locking comparison #2176 asks for. Nothing here changes a file or a script.

### What a version change does today

- **Held records** (the eight in `scripts\release\RecordShape.ps1`): each kind lists the versions this checkout understands, and every one is `@(1)` today. Only `collection-plugins.json` must say its version (`MustSay`); the other seven predate a version field and are read as version 1 when it is missing. A record that says a version the checkout does not list is refused with "update the checkout, or the record came from somewhere else". So a version 2 is a two-step change: first a checkout that lists both 1 and 2 goes out, then a writer starts writing 2. Going back is the same steps in reverse.
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
| Site JSON through `putJson` | None | Yes: same-folder temp file then rename, with a copy-then-delete fallback where Windows refuses the rename | One Node process, synchronous read and write. `board.json` adds a revision per board (`_rev`, #2188): a save from an older copy gets 409, a save with no revision 428 |
| Site JSON written directly (the launcher session log files, the site's own `config.json`) | None | No: `fs.writeFileSync` straight onto the file | None |

### Options for the next change, and the do-nothing case

- **Do nothing.** Held records already refuse a version they do not know, the feed and the VPS already have a tested way back, and the site's main write path is already temp then rename. What stays open is that the site files not held yet still read a malformed file as empty.
- **Version field on the site's critical files.** The same rule as RecordShape: missing means 1, unknown means refuse at startup. Rollback is the reverse two-step above. It needs a readiness signal so a refused start is seen (slice 4).
- **Atomic writes for the record writers.** Temp then move, as DeployedBuild.ps1 already does. Low risk; it only matters for a crash mid-write, which git already covers for committed records.
- **More clash checks.** Extend the board's revision idea to the other files #2188 names (`notes.json`, `inbox.json`, `open-tickets.json`, `trouble.json`). A file lock is not needed while one Node process writes them.
## Next slices, in order

Done: the box-side reads (#2404), the feed store's contracts (#2420) and holding every feed send to them (#2180), `bans.json` failing closed (#2186), and `pk.json`, `linked.json`, `sessions.json` and `signins.json` held with a readiness signal, `/api/ready` (#2180).

No slice of #2180 is left. What the options above name (a version field on the site's files, atomic writes for the record writers, more clash checks) is a change of its own, taken only when a format change needs it.
