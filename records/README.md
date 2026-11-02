# Records

What a release is checked against, kept apart from the scripts that write and
read it (issue #440, phase 8):

- `client-build.json`: the six SkyMP client files built from the fork, by
  hash, and the fork commit they came from. `scripts\release\New-ClientBuildRecord.ps1`
  writes it; Build-Launcher puts it inside the launcher, and Sync-Client and
  Ship refuse a client that is not this build.
- `front-build.json`: the front, skymp5-front built by webpack from the same
  fork commit, every file by hash (#2754). `scripts\release\Build-Front.ps1
  -Record` writes it when the pin moves; Build-Front puts the build in
  `local\thornswood-front.zip` only when it is this one, and Go.ps1 refuses a
  zip that is not. Its `packages` are the npm packages webpack put in
  build.js, each with its licence text in `front-licences\<name>.txt`
  (#3751); the installer and every update that carries build.js carry those
  texts.
- `server-build.json`: every server file the fork builds the same way (the
  binary, the JavaScript half the server runs, its map and the rest
  `scripts\deploy\ServerBuild.ps1` names), and the one fork commit.
  `scripts\release\New-ServerBuildRecord.ps1` writes it (Build-Server runs it),
  and Export-ServerPayload, Publish-Server, Deploy-Server and the installer on
  the box refuse any server file that is not this build. `"lightPlugins": true`
  says the recorded fork loads light plugins (it has espm::IsLightPlugin), and
  only then does Deploy-Gamemode list them in the server's load order (#1715).
- `steam-build.json`: the public Steam build of Skyrim last looked at and
  accepted. `scripts\dev\Check-Outside.ps1` goes red when Steam moves past it,
  which is the day to try the downgrade on one machine.
- `skyrim-pin.json`: the build of Skyrim a release is pinned to, its
  SkyrimSE.exe size, the size of the newer build Steam hands out, and the
  three depot manifests the Downgrade button asks Steam for (issue #471).
  Publish-Update writes it into version.json and launchers take it from
  there. No script writes this one: it is changed by hand, in the same pull
  request as the script extender, the collection revision, the launcher's
  compiled fallback (Downgrade.cs, Config.cs), because a pin move is one
  release; the install reads the exe size from records\skyrim-files.json. `launcher\tests\test-skyrim-pin.ps1` fails while
  they disagree.
- `ui-gone.json`: the 37 Daedric Online menu files (name and sha256) and the
  41 unused skymp5-front svgs, bg.png, and the four Futura PT and DIN Pro
  faces main's older front build named (#1317), that must never ship and that
  every pack deletes (issue #1318). `Ship-Rules.ps1` loads it; Build-Launcher puts
  it inside the launcher; OwnGame.Foreign reads that copy so a refresh cannot
  copy those files back. No script writes this one: it is changed by hand, in
  a pull request. `tests\test-ship-rules.ps1` fails while Ship-Rules and
  OwnGame disagree with it.
- `shipped-not-ours.json`: 165 of the 166 loose files of other authors
  (67.6 MB) that our packs shipped as ours until the scrub of 29 September,
  each with the bytes and sha256 it had, measured on 12 October 2026 on the
  shipping machine's main install (#1178). The 166th, the other server's
  haybale, would name that server, which no tracked file may (#400), so the
  launcher's `Leaks.cs` takes it out of Thornswood's own folder by its shape
  and bytes instead. `Ship-Rules.ps1` reads it and stops on any
  path it does not call another author's; Publish-Update puts every one in
  each release record as gone at its sha256, and the launcher deletes one only
  while it still has those bytes and Vortex does not deploy the path. No
  script writes this one: it is changed by hand, in a pull request.
  `tests\test-shipped-not-ours.ps1` holds it.
- `skyrim-files.json`: every file of the pinned build, 46 on 1.6.1170, with
  its bytes, SHA-1 and depot, read out of Steam's own manifests of the three
  depots `skyrim-pin.json` names by `scripts\release\New-SkyrimFilesRecord.ps1`
  (issue #1232). Build-Launcher puts it inside the launcher, and Thornswood's
  own folder takes a file from the Steam copy as Skyrim's own only when it is
  on this list, so a mod put into the Steam copy by hand never gets in. Run
  the script again in the same pull request as a pin move;
  `launcher\tests\test-skyrim-pin.ps1` fails while the two disagree.
- `recipe-owners.json`: the recipes whose owner or rank is a decision rather
  than a reading, each with the measured reason it cannot be derived:
  `"owner"` is RECIPE_OWNER and `"rank"` is RECIPE_RANK in
  `scripts\dev\Build-RecipeTable.ps1`, which reads them from here. No script
  writes this one: it is changed by hand, in the pull request that adds the
  recipe it names. It is data so that a recipe change is this file and
  `game\content\Thornswood-Content.esp` and nothing else, the two files the
  box's Rebuild-ContentTables takes from a pull request to rebuild its tables
  with main's own builders (Patrick, 30 Oct 2026, B on the report page, #3470).
- `game-strings.json`: the loose string tables of the localized masters the
  content tools read whose names are in no Skyrim archive, by size and
  sha256 (#2899): RaceCompatibility.esm's three, measured 20 Oct 2026.
  `scripts\mods\Send-GameArchives.ps1` sends them to the box beside Skyrim's
  archives, and `Run-OnBox.ps1` links them into a run, so Build-LastPlugin
  runs there. No script writes this one: it is changed by hand, in a pull
  request, when such a master joins `game\data\last-plugin.json`'s masters;
  Build-LastPlugin says "no strings for <plugin>" until it is.
- `update-creation-club.json`: the Creation Club records Bethesda keeps in
  Update.esm (354 on build 1.6.1170, editor ids starting cc). Every Special
  Edition has them, but their art comes with the Creation Club files
  Thornswood leaves out, so the harvest, hunt and /give and /spawn table
  scripts skip them and `tests\test-special-edition-only.js` fails when a
  gamemode table hands one out (issue #479). `node
  scripts\mods\Check-CreationForms.js --write records\update-creation-club.json`
  writes it; run it again when the Skyrim pin moves.
- `generated.json`: what the launcher builds in Thornswood's own game folder
  on each computer before Play (issues #1247 and #3715,
  `launcher\app\GeneratedBuild.cs`, which `scripts\mods\Build-Generated.ps1`
  also runs); it is compiled into the launcher, and no release carries what it
  builds: the behavior patch codes Pandora Behaviour Engine+ generates the behavior files with, and
  the BodySlide slider sets built into the bodies, each at its own slider
  defaults. No script writes this one: it is changed by hand, in a pull
  request. The build refuses a set or a slider move that shapes the
  breasts, the seat, the genitals or the nipples (#1004) or takes the
  underwear off (#405); after a change every launcher on the next release
  builds the files again before Play, and Ship stops first when the
  collection installed on the shipping machine cannot build them.
- `most-online.json`: the most people in the world at once (`people`) and
  the seats over it that only the Discord staff roles may take
  (`staffSeats`), with Patrick's decisions in its `note` (issue #481), and
  the most people who hold a voice place at once (`voice`), never fewer than
  the two together, so everybody seated has one. Only somebody in the world
  holds one: somebody waiting in line at the menu holds a socket for text
  chat and the line, and no voice place (#3570). Those are main's. Its `dev` object holds the
  same three for the dev server and dev voice (Patrick, 12 Oct: 5, 0 and 5),
  and a record without one gives dev main's numbers.
  `scripts\deploy\MaxOnline.ps1` reads it for Deploy-Gamemode,
  Deploy-DevGamemode (dev), Publish-Server and Publish-Update (each for its
  channel) and Install-Voice (dev for `C:\Thornswood-Voice-Dev`), and
  `site\lib\game.js` reads `people` and `staffSeats` when the site runs from
  the repository. What people are shown, the M of "N of M awake", is the
  seats, people and staffSeats together: 30 on main, 5 on dev. No script writes
  this one: it is changed by hand in a pull request, then each server is
  deployed and a Ship carries it to the feed.
- `upstream-not-taken.json`: the upstream SkyMP commits the fork is not
  taking, each by its full sha with the reason and who decided (issue
  #1791). `tests\test-fork-upstream.js` is red every night upstream `main`
  has a commit `thornswood/engine-changes` lacks that is not listed here.
  No script writes this one: it is changed by hand in a pull request.
- `papyrus-events.json`: the fork's Papyrus event list, both halves (issue
  #503). The client half is what the blocker in skyrim-platform's
  FridaHooks.cpp lets through on each person's machine: the event names
  and the script names that free an object. The server half is the event
  names the server's own Papyrus machine is sent, that it attaches scripts
  only to placed references, the scripts its storage can load (built in,
  data\scripts, and the archives the "archives" setting names, which no
  deploy script writes), and what InitScripts drops. `readAt` is the fork
  commit it was read at. `node scripts\dev\PapyrusEventList.js --write`
  writes it from the fork at the pin; `scripts\dev\Audit-PapyrusEvents.py`
  judges the load order against it. `tests\test-papyrus-event-list.js`
  holds it to the rest of this repository on every pull request, and the
  nightly fetches the fork and reads it against the pin. The check is the
  list, not the commit: a pin moved over fork work that leaves the list
  alone passes, and one that changes it fails there, naming what changed.
- `papyrus-missing.json`: the scripts the load order's records attach that
  no archive or loose file carries on a PC with the game, measured there
  with `scripts\dev\Audit-PapyrusEvents.py --json` (#3105). The game skips
  them. `scripts\dev\Build-CrimeTable.py` stops when a folder lacks any
  other attached script, so a folder with only some of the archives (the
  box) cannot write a crime table that calls the scripts it lacks harmless.
  Written by hand from that measurement, again when the load order changes.
- `signing\`: the code signing setup, with its own README. On since
  27 September: Ship refuses a launcher that is not signed (Developer-Guide.md).

## Provenance notes

Each of these says how one engine build was made when it was not a plain
build of the pinned commit: which files were built again, which kept the
bytes of an earlier build and why that is the same source, and what was run
to check it. They are evidence for the records above at the commit each
names. No script reads them. `THIRD-PARTY.md` and
`site\data\site\credits.md` point at the one behind the current pin.

- `client-provenance-4952dbb6.md`, `client-provenance-e0135f5a.md`,
  `client-provenance-df1a6c39.md` and `client-provenance-d6c99400.md`: the
  six client files at those fork commits (30 September to 2 October).
- `creation-clothes-provenance.md`: the client and SkyrimPlatformImpl.dll
  built for the starting clothes in character creation (fork commit
  bd1d80e2, 3 October).
- `runner-isolation.json`: what a runner account on the VPS must not reach (production paths, groups), the crash dump folder it may only write, the age limit for files left in its temp folder, and differences agreed as intentional. `scripts\vps\Check-RunnerIsolation.ps1` compares the runners against it (issue #2161).
- `remote-commands.json`: every call under `scripts\` that reaches the VPS (ssh, scp, Invoke-ThornswoodRemote and its wrappers, Remote.ps1), what it sends, and the class it needs: a gate verb, admin, or transport. Read from the code; the ops repo's `DEPLOY-IDENTITIES.md` section 2a is its summary. `tests\test-remote-command-map.ps1` fails when a remote call has no row or a row has no call (issue #2182). A row names its call by script, function, command and an anchor, a line of text from the call (or just above it), never by its place in the file, so a call put in elsewhere moves no row (#2498).
- `prod-parity.json`: what the VPS should look like (which ports listen where and as which program, each task's account and triggers, the services' accounts, which live files must match which repository file, the TLS margin, environment variables that must not be set) and the differences agreed as intentional, each with its reason. `scripts\vps\Check-ProdParity.ps1` compares the box against it; no secret belongs in it (issue #2165).
- `cloudflare-pages.json`: the Cloudflare Pages project that serves the site's plain pages from Cloudflare at its pages.dev address (#5190): built by Cloudflare from this repository with `scripts\deploy\Export-Pages.js`, no custom domain (thornswood.net stays the box's). `tests\test-5190-pages-export.js` holds it to the script.
- `cloudflare-cache-rules.json`: the cache rule on the thornswood.net zone that lets Cloudflare's free plan keep the site's public pages, and only those (#5190). The site marks each public page with `Cloudflare-CDN-Cache-Control` and nothing else; the rule caches only what is marked. `tests\test-5190-cloudflare-cache.js` holds its paths to `PUBLIC_PAGES` in `site\server.js`.
- `collection-permissions.json`: what each mod in the Nexus collection says
  on its own page's Permissions and credits about being put in a collection,
  one entry per Nexus mod of the revision `collection-plugins.json` is, with
  the files and plugins it brings, when the page was read, by whom, and the
  page's own words (issue #3649). `collections` is `allowed`, `not stated` or
  `not allowed`; Thornswood's own two mods are `ours` and need no reading.
  Only a line against being in a collection is `not allowed`; one against
  uploading or redistributing the files is `not stated` (Patrick, 27 Oct,
  q-3649-no-upload-lines).
  `node scripts\release\collection-permissions.js update <collection.json>
  --revision <n>` takes the list of mods from a new revision and keeps every
  reading, so a new mod comes in unread. `New-NexusRevision.ps1` makes and
  publishes no revision with a mod that has no reading or whose page says no,
  and `tests\test-collection-permissions.js` fails on a page not read or a
  plugin from a mod the record does not list. The pages answer a cloud
  session with a 403, so they are read in a browser on One.
- `collection-dropped.json`: the plugins a server may stop loading when it
  moves to the revision `collection-plugins.json` names, because that
  revision takes them out, each with why every form it added can go from a
  running world (issue #4069). `Deploy-DevGamemode.ps1 -LoadOrder
  -FromRecord` lets its order leave out these and no other plugin the
  running server loads, and only while the two name the same revision.
  Changed by hand in the pull request that moves the records to a new
  revision.
- `collection.json`: the collection as it should be (issue #5189): each
  Nexus file it installs with the plugins that file puts in Data, every
  plugin in the collection's order with its load-after rule and what its
  header says, and the plugins the servers load that a change takes out. A
  mod change is a pull request to this file (`docs\COLLECTION-CHANGES.md`).
  `scripts\release\Check-CollectionRecord.ps1` holds it to the load order,
  `collection-permissions.json` and the servers' order with no key, and
  `tests\test-5189-collection-record.ps1` runs it in the gate. Its merge runs
  `.github\workflows\collection-record.yml`, which drafts the revision it
  describes, holds the draft to it and publishes it
  (`Publish-CollectionRecord.ps1`). Made from a laid out revision by
  `New-CollectionRecord.ps1`, and its `revision` moves with the records
  that follow a publish.
- `asset-provenance.json`: the asset provenance register (issue #2177). Every picture, video, sound, font, mesh, texture, interface file and plugin Thornswood hands to people or shows them: where it came from, who made it, its licence or permission, the credit it asks for, who approved it and when, where it is published and its sha256, or which of those is not recorded and who can answer. Files that ship from the game folder but are not in the repository are in it by name, and gallery uploads and the collection's mods are dispositioned. Operator only: nothing that builds a pack, the installer, the launcher or the site reads it. A permission itself is never written in it; an entry says where it is kept. No script writes it: it is changed by hand in the pull request that adds or changes an asset, and `tests	est-asset-provenance.js` fails on a tracked asset with no entry or a changed hash.
- `cloudflare-tunnel.json`: the Cloudflare Tunnel the site reaches
  Cloudflare through (#5334): the account, the zone, the tunnel's name, the
  cloudflared release by SHA-256, the tunnel's routes to Caddy on
  127.0.0.1:443 and the two DNS names with the box's address.
  `scripts\deploy\Install-Tunnel.ps1` reads it and makes Cloudflare and the
  box match it; nothing writes it, and no token is in it. A new cloudflared
  is its version, URL and SHA-256 changed together, from the release page.
- `merchant-runtime-provenance.md`: the server module built for merchant
  settlement, and why the six client files kept their e6534129 bytes (fork
  commit a247ef27, 4 October).

`client-inputs-4952dbb6.json`, the hashes of the cached build inputs behind
`client-provenance-4952dbb6.md`, was removed on 5 October (issue #1347):
nothing read it, the engine has been pinned to other commits since, and it
named folders on the machine that built it. It is in the history at 9e4ba70.

Change a record only by running the script that writes it, in the same pull
request as the build or the fork commit it describes.
