# How gamemode.js is put together

This page is for somebody opening `game\gamemode.js` for the first time. It
is the whole of Thornswood's server side: 69,961 lines and 6 MB in one file on
17 October (about 24,000 when this page was written), loaded by skymp5-server. It says where each system lives, which generated
table each script writes into it, how it reaches the server, how it talks to
the plugins, what it keeps on disk, and which tests read it.

References look like `gamemode.js:chargenTick` or `gamemode.js:// character creation`:
the file, a colon, and a name it declares or its own words, never a line
number (#1075, #2416). Search the file for what follows the colon.
`tests\test-1075-script-citations.js` fails when a cited name goes away.

## Why it is one file

`requireTemp()` in skymp5-server copies the file to a temp folder and requires
the copy, so a relative `require` would look beside the copy and fail. So
every rule and every table is inlined (`gamemode.js:Loaded by skymp5-server through requireTemp()` header). The server
watches the file and reloads it on change after `mp.clear()`, so every block
registers its handlers at load and keeps timers and state on `globalThis`
(`g.__thornswood*`) so a reload does not lose them or double them.

The tables read out of the load order are the one exception (#5191). Each is
its own file, `game\gamemode-tables\<NAME>.json`, and `const <NAME> =
table('<NAME>')` reads it when the gamemode loads, from `gamemode-tables` in
the server's working folder, where `server-settings.json` is read from too
(`gamemode.js:THE TABLES READ OUT OF THE LOAD ORDER ARE FILES BESIDE THE GAMEMODE`).
Pasted into this file, every content change rewrote the same lines here and
no two content pull requests could merge side by side. The load reads the
whole folder once and logs it as a git tree id beside the git blob of
`gamemode.js`, so a deploy can tell which tables a load ran.

The plan for writing it as many source files that are joined into this one
file, with the loader's limits read from the fork and the measurements behind
it, is [GAMEMODE-SOURCE.md](GAMEMODE-SOURCE.md) (#2181).

A handler returns `false` to block an event and anything else to let it
through. Every handler is wrapped in `guard()` (`gamemode.js:guard`), so a throw
is logged and the event goes on. Form ids cross the boundary as descriptors,
`"<low 24 bits in hex>:<plugin>"`, never as load order positions.

## How the blocks find each other

The file runs top to bottom. The early part is plain functions and the `mp.on*`
handlers. From the voice feed block (`gamemode.js:path: '/positions'`) on, each system is an immediately run function
between `// ==== thornswood X ====` and `// ==== end thornswood X ====`,
which publishes its interface on `globalThis`, for example
`g.__thornswoodProgression` (`gamemode.js:g.__thornswoodProgression = {`),
`g.__thornswoodProperty` (`gamemode.js:g.__thornswoodProperty = {`) and
`g.__thornswoodSpoils` (`gamemode.js:g.__thornswoodSpoils = {`). A handler defined earlier, such
as `mp.onActivate` (`gamemode.js:mp.onActivate = guard('onActivate'`), looks those up when it is called, not
at load, which is why it can reach blocks that sit below it.

## The map

In file order, top to bottom. Search for a name to find it; the sections have no fixed lines.

| Section | What is there |
|---|---|
| Header and one-line tables | The contract, then `DATA`, `STATIONS`, `ITEMS`, `WATERS`, `WEATHER`, `WARMTH`, `FOODS`, `RACES`, each one line. See "Generated tables". |
| Small helpers and logging | `rollLog`, `sayLogState`, `logPath`, `log`; `gamemodeId`, which logs the git blob id of the loading file; `voicePort`, `guard`, `notify`, `say`. |
| Respawn resolution | A port of `respawnResolver.ts`: `arrive`, `resolveArrival`. `ensureProperties` declares the actor properties the early blocks use. |
| Gathering stations | `ORES_BY_BASE`, the stations' cooldown (`COOLDOWN_MS`), `addItem`, `takeItem`. |
| Class and profession gates | `classGate`, `halfGate`, `creditWork`, `rankStep`. |
| Starting tools, mining, chopping, charcoal | `TOOLS` and tool wear; salt (`mineSalt`); the swing animation; ore deposits (`DEPOSIT_SIZE`); `mineOre`; chopping blocks (3342-3549, `chopWood`). The kiln is a bench since #2337, answered by nothing here. |
| Character creation (chargen) | See "Character creation" below. |
| Event handlers | `mp.onDeath`, `mp.onRespawn`. `ensureProperties()` and `startChargenTimer()` run at load here. |
| Scripted activators, harvesting, fishing, hunting | The generated `HARVESTS_BY_BASE`, `FISH_BY_BASE`, `GAME_BY_BASE`, `CROPS_BY_BASE`, `HUNTS_BY_BASE` blocks; `harvest`, `fish`, `game`, `loot` for carcasses, `farmActivate`; `mp.onActivate`, which routes every press; `publishServerBases`. |
| Crafting | `RECIPES_BY_ID`, `isRecipe`, `professionName`. |
| Property doors | `BUILDING_BY_DOOR`, `BUILDING_NAME`, `WAY_OUT`. |
| Benches | `BENCH_BY_BASE`, `raceOf`, `raceGate`, `BENCH_ACCESS`, `benchGate`, `craftAnswer`, `recipelessCraft`. |
| `mp.onCraft` | How long a craft takes at the bench (`CRAFT_WORK_MS`, `craftSize`, `mp.onCraftWork`, which the engine asks first and holds the craft for, #3161), key recipe, the handler, and the "gamemode loaded" line. |
| Voice feed | Positions to the voice service; the `online.json` writer. |
| Character roster | `private\characters.json`, sent to the site. |
| The door | The allowed list. See "The door". |
| Server manifest | `data\manifest.json`, `publish`. |
| Progression | The rulebook: `RANKS`, `SPELL_IDS`, `TUNING`, state, rules, the spell book, `TABLE`, `canDo`. |
| Farming | Plots, rank and time, the land, claims in `private\farm-claims.json`, pressing, commands `/plant`, `/claim`, `/plot`. |
| Property | See "Property, offices and rent". |
| Spoils | Nothing the world placed is handed over: a container starts empty (`forbiddenBaseContainer` in the server settings, #3078) and nothing lies on the floor (Thornswood-Last.esp, #3077); where gold comes from (`purse`). |
| Character | Stores the answer as `thornswoodCharacter` and pushes the panel; `gate`, `gateHalf`, `credit`, `/pick` and `/spend` in `command`. |
| Chat commands | See "Chat and commands". |
| Containers and the audit | `mp.onPutItem`, `mp.onTakeItem`, `mp.onDropItem`, audit helpers, lines `take:` and `drop:` in `thornswood.log`. |
| Needs | See "Needs". |
| Social | Friends, parties, mutes, journals, the panel, `thornswoodNear`. |
| Trade | Two people, two offers, both confirm: `begin`, `gold`, `confirm`, `swap`. |
| Mod settings | Issue #488, added 28 September. The 176 GLOB records of five classic mod menus (`MOD_GLOBALS`), kept per profile in `private\mod-settings.json` from the plugin's `/modset` lines and put back at login through `thornswoodModSettings` and its updateOwner script. `tests\test-mod-settings.js`. |

## Startup and settings

At load, in file order: the generated tables at the top; the git blob id is logged
(`gamemode.js:gamemode.js is git blob`); the respawn properties are declared and the chargen timer
starts (`gamemode.js:g.__thornswoodChargenTimer = setInterval(guard('chargenTick', chargenTick),`); `publishServerBases` writes
`data\server-bases.json` (`gamemode.js:publishServerBases`); `gamemode.js:log('gamemode loaded:',` logs
"gamemode loaded" with cell, station and town counts; then each later block
runs its own start. The last log line of a load is the list of chat words
(`gamemode.js:[thornswood] chat commands running:`).

Settings come from `server-settings.json` in the server's own folder, the
working directory (`gamemode.js:logPath`). The gamemode reads `dataDir`
(`gamemode.js:dataDir`), `privDir` (`gamemode.js:privDir`), `thornswoodVoicePort`
(`gamemode.js:voicePort`), `thornswoodChargen` (`gamemode.js:s.thornswoodChargen === false`),
`thornswoodAdmins` (`gamemode.js:cfg.thornswoodAdmins`), `thornswoodTradeShips`
(`gamemode.js:settings.thornswoodTradeShips === true`, off unless it is true: the trade ships of
issue #511, whose register is still read and counted while off; on, a port's crate opens the dock and staff
keep the ports and routes from the Office page of K, issue #2700; at a docked hold anybody may take what is aboard,
written on the manifest as taken by their character and shown to staff, a hold at sea opens for nobody, and what nobody
collects goes into that port's hold drop box under the recipient's name once the staff list's `uncollectedDays` have
passed since it landed, 7 unless staff set it (`gamemode.js:function uncollectedNow`), freeing its line, issue #511),
`thornswoodTradeCarts`
(`gamemode.js:settings.thornswoodTradeCarts === false`, on unless it is false: the trade carts of issue #3158,
a cart stop's crate opens the stop and staff keep the stops and roads from the Office page of K) and `loadOrder`
(`gamemode.js:Array.isArray(doc.loadOrder)`). `Deploy-Gamemode.ps1` writes that file on every deploy
(`scripts\deploy\Deploy-Gamemode.ps1:-NotePropertyName dataDir -NotePropertyValue 'data'`).

## Character creation

`gamemode.js:// character creation` explains why there is a timer and no menu: SkyMP gives the
gamemode no connect event. `chargenTick` (`gamemode.js:chargenTick`) runs every
`CHARGEN_TICK_MS` (`gamemode.js:CHARGEN_TICK_MS`) and moves each person through the
stages kept in the actor property `thornswoodChargen` (`gamemode.js:CHARGEN_PROPERTY`):

1. `appearance`, set by `beginAppearance` (`gamemode.js:beginAppearance`) in the hall
   (`HALL`, `sendToHall`), while the face is made.
2. `choosing`, set by `beginChoosing` (`gamemode.js:beginChoosing`): the choice is made
   on K in the character panel.
3. `done`, set by `arriveAt` (`gamemode.js:arriveAt`), which moves the person to
   the start spot of the town they picked (`CHARGEN.towns` as `PASSAGES`, the
   `start` of each town; #2622), and welcomes them: "Welcome to (hold), Safe
   Travels." The inn spot (`arrival`) is staff's `/tp <town> inn`.

An old `arriving` state is folded into `done` (`gamemode.js:if (state.stage === 'arriving') {`).
`"thornswoodChargen": false` in `server-settings.json` switches the hall off.

A saved character the server cannot read at start (its base form or race not
in the load order, or an appearance that will not parse) is kept on disk as
it was, and its id is never given to a new form (fork PR 33, #1269). The
profile then has no character, so spawn makes it a new one and calls
`created()`, where `tellKeptCharacter` asks the engine
(`mp.getUnreadableChangeForms(profileId)`) which of the profile's records were
kept, writes them on the new character in `thornswoodKeptCharacters`, and
says one line to the person once: the earlier character was kept, ask staff
with `/helpme`. It runs whether the hall is on or off. An engine build without
the binding is said once in the gamemode log, and nobody is told.

Body shape is height and weight only (#993, "BODY SHAPE" in `gamemode.js`).
`mp.onUpdateAppearanceAttempt` holds the weight in a sent appearance to 0 to
100 and drops any field the engine does not know. `thornswoodBodyReset` in
`server-settings.json` puts every character made before this through the same
check once when it comes online; it is on unless it is `false`.

## The door

`gamemode.js:no allowed.json, door is off`. It compares each connection's profile id with
`private\allowed.json` (`gamemode.js:path.join(privDir, 'allowed.json')`), fetched from the site with the
key in `private\door.json` (`gamemode.js:path.join(privDir, 'door.json')`) and refreshed on a timer
(`gamemode.js:refresh`). It turns somebody away only when that file says
`"enforce": true`; otherwise it writes WOULD TURN AWAY in `private\door.log`
(`gamemode.js:WOULD TURN AWAY profile`). `scripts\ops\Set-Door.ps1` sets both. docs/guide/secrets.md,
"Who gets into the game", says what it can and cannot keep out.

Turning somebody away (`turnAway`, #1894) is the same as every other end on
purpose (#1157): the sentence in their chat (`TURNED_AWAY`: not on the list,
and thornswood.net/join to apply; on the dev server, that it is for staff and
to play from the Thornswood launcher instead), the same sentence as
`{ end }` on their line so their game closes its own connection and goes back
to the character choice with it, and the kick five seconds later, the join
pass refusal's wait, for a game that does not close itself. Somebody off the
list because they are banned or their character is dead for good (the `bans`
and `pk` in the same `allowed.json`) is left to the staff block's ban sweep,
which ends the session with the ban and its reason.

## Professions, benches and BENCH_ACCESS

The rulebook is `TABLE` in progression (`gamemode.js:TABLE`). Stations ask
`classGate`/`halfGate` early in the file and `gate`/`gateHalf` in the
character block. A crafting bench is allowed or refused by `benchGate`
(`gamemode.js:benchGate`): `BENCH_BY_BASE` turns a furniture base into its bench
keyword, and `BENCH_ACCESS` says for each keyword whether anyone may use it
and otherwise which profession halves may, from which rank. `craftAnswer`
(`gamemode.js:craftAnswer`) then checks the recipe in `RECIPES_BY_ID`, and
`raceGate` (`gamemode.js:raceGate`) the race lock on a people's own dress.

## Spells, tomes and staff spells

The rules are in progression and the three blocks after the character block.

- **A mage's spells.** Spell points are `spells.points` (two to start, one per
  rank of a school, two at Master). `pickSpell` (K panel, `/pick spell`) and
  `learnFromTome` (reading a tome) ask the same three things: a point, the
  rank in the spell's school, and a spell of that school one rank down.
  Somebody a Master mage taught (`teach`) holds `LIMITS.outsiderSpells`
  places instead of points, and their school never leaves Novice.
- **Spell tomes** (`thornswood spell tomes`). `mp.onReadBook` asks `read`,
  which resolves the tome's spell from the records and runs `learnFromTome`;
  answering false keeps the tome and takes the spell back.
- **Staff spells** (`thornswood staff spells`, #1128). What a staff binds is
  unlocked into `staffSpells` (spell descs), and `craftAnswer` refuses a staff
  whose spell is not there. An Enchanter unlocks on K with staff spell points
  (`staffPoints`: two to start, one per Bladebinder rank, two at Master),
  their Bladebinder rank capping the spell's rank and a staff spell of the
  rank below needed (`pickStaffSpell`, `/pick staffspell <desc or name>`), no
  tome. Somebody a Master Bladebinder taught learns one only from its tome,
  under `LIMITS.outsiderSpells` and Novice only (`learnStaffFromTome`). Each
  staff spell's rank is the rulebook's when `SPELLS` lists it, else the one
  `Build-RecipeTable.ps1` read from the records into `STAFF_SPELLS`. An
  unlocked staff spell is put on the character with `spellOn` (and again on
  every spawn in `grantKnown`), because Skyrim's crafting menu lists a staff
  only for somebody who knows its spell.

## Property, offices, rent and gold

The register is `private\property.json` (`gamemode.js:registerPath`;
`save`). A claim is made at the door (`touched`, `claim`)
and carried by the deed (`giveDeed`). Locks and keys follow
(`lockScript`, `mold`, `cutKey`). The offices are Discord roles the
door reads from the site (`__thornswoodOffices`, read through `officeOf`,
#2551): a Jarl gives their hold's Court, Steward and Guard on the Office
page (`officeCmd`, which asks the site to set the role), and only a
steward can `evict`. A hold's box is the drop box on its board
(`dropboxCmd`), where rent (`rentDue`, `rentCmd`) is paid and trade ship
cargo nobody collected waits for a steward to hand out (`boxShipped`, #511); board fees
(`takeGold`) are counted on the hold's ledger (`funds`). Notice boards come after them. Coin enters the world in one
place, the starting purse (`purse`, `test-one-mint.js`), and otherwise
moves by trade (`gold`). No container holds gold the world put there,
and nothing lies on the floor (Thornswood-Last.esp, #3077), so a coin
purse a person has was handed to them and counts as gold.

## Needs

Hunger, thirst and exhaustion, with warmth, in one block. The whole balance
is `NEEDS` (`gamemode.js:NEEDS`), `COST` (`gamemode.js:COST`) and `TEMP_COST` (`gamemode.js:TEMP_COST`).
Warmth: `warmthTarget`, `fireWarmth`, `exposure`,
`weatherRow` off `WEATHER`, `insulation` off `WARMTH`. Food
and drink: `foodKind` off `FOODS`, `waterKind` off `WATERS`,
`consumed`. The bard, which the tick reads off the emote
wheel (`bardSeen`, #1631), `/rest`, the tick, the HUD script and burning. State
is `thornswoodNeeds`.

## Chat and commands

`WORDS` (`gamemode.js:WORDS`) is every word the server answers, and
`gamemode.js:PLAYER_WORDS` is the part everybody is told about. `handle`
(`gamemode.js:handle`) answers each one. The teleport is here
(`gamemode.js:coc does nothing on this server and never did`), because the client forwards only five console commands
and `coc` is not one of them. Roles are `admins`, `isDev`, `isPlaytester`
(`gamemode.js:isDev`, `gamemode.js:isPlaytester`). The restart countdown is `gamemode.js:checkRequest`: Ship and
the Deploy scripts drop `restart.json` in the data folder
(`gamemode.js:Request-Restart.ps1 drop restart.json over ssh`), and the gamemode warns at the marks in `MARKS`
(`gamemode.js:MARKS`), on screen at 60 and 30 seconds.

## How it talks to the plugins

There is no custom packet. Two paths:

- **Commands in.** A line typed in the game's chat starting with `/` goes up
  the voice socket, and the voice service queues it
  (`voice\voice-server.js:GET /commands used to empty this queue in one splice`). Every 1.5 seconds the gamemode
  asks `GET /commands?ack=1` on `127.0.0.1:<voice port>`
  (`gamemode.js:poll`), runs each one through `dispatch`
  (`gamemode.js:dispatch`), which holds a line for a character not yet back in
  the world, and acknowledges with `POST /commands/ack`. Ids already run are
  remembered so a command offered twice runs once (`gamemode.js:pollSaid`).
- **Answers and state out.** Chat replies go back through the same service,
  `POST /say` (`toProfile`, `gamemode.js:toProfile`). Everything a panel or HUD
  draws is an actor property made with `mp.makeProperty`
  (`thornswoodCharacter`, `thornswoodNeeds`, `thornswoodTrade` and the rest),
  which the client scripts in the property read.

The voice feed (`gamemode.js:path: '/positions'`) posts every position to
`POST /positions` every 200 ms. `voicePort()` reads the port from
`server-settings.json`, so the dev server talks to the dev voice service.
This block is the only copy: the older one beside the voice service, and the
deploy script that wrote it in, went in #2736.

## Where its data lives on the VPS

In the server's folder, `C:\Thornswood-Server` live and
`C:\Thornswood-Server-Dev` dev:

| Folder | What the gamemode keeps there | Served to anybody? |
|---|---|---|
| `data` | `online.json`, `manifest.json`, `server-bases.json`, `thornswood-log.json`, `restart.json` | Yes: the resources port (3000 live, 7788 dev) hands out anything under it over plain HTTP (`gamemode.js:The resources server hands out anything under data over plain HTTP`) |
| `private` | `characters.json`, `allowed.json`, `door.json`, `door.log`, `property.json`, `farm-claims.json`, `mod-settings.json` (the first six moved from `data` on 25 September, issue #541, because they carry profile ids), and the books, `books.json` and `last-left.json` (moved from `data` on 16 October, issue #2582, for the same reason); the gamemode never reads, moves or removes a copy in `data`, because the alpha carries no data over a change (issue #3094); and the other registers naming characters, `law.json`, `beds.json`, `embassy.json`, `take-limit.json` and `dungeon-rewards-ledger.json`; and `deleted-characters.json`, a list of deleted characters that `Delete-Person.ps1` writes and the gamemode lets go of at its next start and then deletes (issue #2351); `Reset-Character.ps1`, `Wipe-Saves.ps1` and `New-Character.ps1` write it too, naming the characters they throw away by form id and never a profile (issues #2668 and #2673); and `trade-cargo.json`, the trade ships' register of ports, routes and what each hold carries, naming characters by form id and profile and never by name (issue #511); and `trade-carts.json`, the trade carts' register of the same shape, with who drives each cart on the road (issue #3158) | No |
| `world` | Not the gamemode's: SkyMP's changeform database, every reference the server has written to (`scripts\ops\Wipe-Saves.ps1:the changeform database. Every reference the server has ever written to`; `scripts\release\Where.ps1 ChangeForms` names its folder in the server build) | No |
| the folder itself | `thornswood.log`, rolled at 4 MB with five kept (`gamemode.js:LOG_MAX_BYTES`) | No |

`scripts\ops\Wipe-Saves.ps1` starts the world over by moving `world`,
`private\characters.json`, `private\property.json`, `private\farm-claims.json`
and, since 17 October (issue #2351), every other register naming a character:
`law.json`, `beds.json`, `embassy.json`, `books.json`, `last-left.json`,
`take-limit.json`, the trade ships' `trade-cargo.json` (issue #511, with the
staff list of ports and routes in force beside the goods aboard), the trade
carts' `trade-carts.json` (issue #3158), the dungeon
chests' ledger with its `.initialized` mark,
and a waiting `deleted-characters.json`. It leaves `mod-settings.json`, each
person's menu choices, and `merchant-ledger.json`, which the merchant code
needs to start. Once everything has moved it writes a new
`deleted-characters.json` (`scripts\ops\Release-List.ps1`, issue #2668)
naming every character in the world it set aside, by form id only, with the
ids of a list it set aside carried over and every part whose register it
moved marked done, so the first start lets the merchant ledger go of a wiped
character's supply waits, commission promises and waiting trade and deletes
the list. `scripts\ops\Reset-Character.ps1` and, on a local test server,
`scripts\ops\New-Character.ps1` (issue #2673) write the same list for the
characters they throw away, with nothing marked done; a profile keeps its id
and what it holds either way. The part `saves` (`server-log.js`, on the VPS)
acts only on the profiles a list names, and a server on this machine does
not start under `server-log.js` at all, so the writer marks `saves` done
whenever the list it writes names no profile.

Every one of these names a character by one shape of form id, the runtime
id, `0xff000000 | local` (`game\form-id.js`, issue #2870): the list's
`actors`, and in `merchant-ledger.json` (version 2, its `sha256` over the
rest) the supply waits' keys and the commission owners. Nothing converts
the old shape: in the alpha there is no compatibility code, carry-over or
migration for any data (Patrick, 31 Oct). The gamemode, `server-log.js`,
`Release-List.ps1` and `Delete-Person.ps1` refuse a list holding a local
id and leave it as it is. The merchant code refuses a version 1 ledger, so
on one the NPCs and merchants do not start (the log says `NPC server
runtime failed to start`). On the deploy that carries #2870, do this on
each server, with that game server stopped:

1. Run `node scripts\ops\Verify-FormIdShape.js --server <folder>`. It
   writes nothing, and prints what each register holds by shape.
2. If it prints `merchants` `version` 1, replace that server's
   `merchant-ledger.json` with what `node
   scripts\ops\New-AlphaMerchantLedger.js --confirm-discard-alpha` prints.
   This is the alpha reset: merchant stock and purses start fresh, and
   nothing of the old ledger is carried over.
3. If it prints `list` `actors` `local` above 0, the release list is not
   converted and not deleted. It waits for a person, because it may hold
   deletion requests the privacy page promises to finish: until then the
   gamemode lets nothing on it go and `Delete-Person.ps1` will not add to
   it.

## Generated tables

Never hand edit these. Each script writes its json in `game\data` and then
its table's file in `game\gamemode-tables`, or, for `STATIONS`, `ITEMS`,
`CHARGEN` and `STAFF_DATA`, its own line in `game\gamemode.js`. The tables
the content builders write are listed in `scripts\mods\content-tables.json`.
Run the Build-Recipe step
after the ore, harvest, hunt and race tables, and Build-Bench after it,
because each reads the one before.

| Table | Script | Json | Where the script installs it |
|---|---|---|---|
| `WATERS` | `Build-WaterTable.js` | `waters.json` | `Build-WaterTable.js:install` |
| `WEATHER` | `Build-WeatherTable.js` | `weather.json` | `Build-WeatherTable.js:install` |
| `WARMTH` | `Build-WarmthTable.js` | `warmth.json` | `Build-WarmthTable.js:install` |
| `FOODS` | `Build-FoodTable.js` | `food.json` | `Build-FoodTable.js:install` |
| `RACES` | `Build-RaceTable.js` | `races.json` | `Build-RaceTable.js:install` |
| `STAFF_DATA` | `Build-StaffData.js` (#2873): the staff files the gamemode reads at run time, carried because the server's copy has no `game\data` beside it | `furniture.json`, `merchant-traders.json` (first steps' Cook, #5137), `property-word.json`, `thalmor-patrols.json` | `Build-StaffData.js:const LINE` |
| `ORES_BY_BASE` | `Build-OreTable.ps1` | `ores.json` | `Build-OreTable.ps1:Write-GamemodeTable 'ORES_BY_BASE'` |
| `HARVESTS_BY_BASE`, `FISH_BY_BASE`, `GAME_BY_BASE`, `CROPS_BY_BASE` | `Build-HarvestTable.ps1` | `harvests.json` | `Build-HarvestTable.ps1:Write-GamemodeTable 'HARVESTS_BY_BASE'`, one file for each of the four |
| `HUNTS_BY_BASE` | `Build-HuntTable.ps1` | `hunts.json` | `Build-HuntTable.ps1:Write-GamemodeTable 'HUNTS_BY_BASE'` |
| `RECIPES_BY_ID` | `Build-RecipeTable.ps1`, which also reads `docs/systems/cut-items.json` for what leaves the open book | `recipes.json` | `Build-RecipeTable.ps1:Write-GamemodeTable 'RECIPES_BY_ID'` |
| `STAFF_SPELLS` (staff spells block) | `Build-RecipeTable.ps1`, with each spell's school and rank | none | `Build-RecipeTable.ps1:Write-GamemodeTable 'STAFF_SPELLS'` |
| `BUILDING_BY_DOOR`, `BUILDING_NAME`, `WAY_OUT` | `Build-DoorTable.py` | `doors.json` | `Build-DoorTable.py:changed = gamemode_tables.write(name` |
| `BENCH_BY_BASE`, `BENCH_ACCESS` | `Build-BenchTable.py`, from `recipes.json` | none | `Build-BenchTable.py:gamemode_tables.write('BENCH_BY_BASE'` |
| `SPELL_IDS` | `Build-SpellTable.ps1` | `spells.json` | `Build-SpellTable.ps1:Write-GamemodeTable 'SPELL_IDS'` |
| `DATA` | `Install-GamemodeConsts.js` | `data.json` | `Install-GamemodeConsts.js` |
| `DATA.worldspaces`, inside `DATA` | `Build-WorldspaceTable.js`, from the WRLD records of the load order | `data.json` (`worldspaces`) | `Build-WorldspaceTable.js:install`, the list and nothing else of the line |
| `DATA.ownWorlds` and `DATA.ownWorldDoors`, inside `DATA` | `Build-WakeTable.js`, from the doors, rooms and locations of the load order | `data.json` (`ownWorlds`, `ownWorldDoors`) | `Build-WakeTable.js:install`, the two tables and nothing else of the line |
| `STATIONS` | `Install-GamemodeConsts.js` | `stations.json` | `Install-GamemodeConsts.js` |
| `ITEMS` | `Install-GamemodeConsts.js` | `items.json` | `Install-GamemodeConsts.js` |
| `CHARGEN` | `Install-GamemodeConsts.js` | `chargen.json` | `Install-GamemodeConsts.js` |

`DATA`, `STATIONS`, `ITEMS` (`gamemode.js:DATA`, `gamemode.js:STATIONS`, `gamemode.js:ITEMS`, at the top) and `CHARGEN` (`gamemode.js:CHARGEN`)
are installed from checked-in JSON by `scripts\dev\Install-GamemodeConsts.js`
(`data.json`, `stations.json`, `items.json`, `chargen.json` under `game\data`).
They are not read out of the plugins: the values were recovered into JSON when
`tools\thornswood-src` was retired (5d1f3f0). Edit the JSON, then run the
installer. `--check` proves the gamemode matches.

The one part of them that is read out of the plugins is `DATA.worldspaces`,
the set `WORLDSPACES` reads as a worldspace rather than a room (#1896): every
WRLD record of the load order, overrides counted as the record they override.
`scripts\dev\Build-WorldspaceTable.js` writes it into `data.json` and the DATA
table, and `--check` says whether both hold the load order's list. Run it when
a plugin that adds a worldspace comes into the load order. Its two readers,
`resolveArrival` and `climateOf`, pick the same hold for a worldspace in the
set or out of it, because `cellToHold` names no worldspace; what the set
changes is the death log's `nearest-capital` for `unmapped-interior`, and,
for a hold with no temple of its own, a borrowed door measured from where the
person fell rather than from the hold's capital.

`DATA.ownWorlds` is read out of the plugins as well (#1909):
`scripts\dev\Build-WakeTable.js` keys every worldspace with coordinates of its
own (one whose doors do not land within a cell of the doors they lead to in
Tamriel's coordinates) to the Halls of the Dead, temples and inns whose front
door stands in it. `resolveArrival` wakes a death in one of those at the
nearest of them, and never measures it against the mainland. It also writes
`DATA.ownWorldDoors`, every door into such a worldspace from outside it (the
doors of a room whose only ways out lead back into it are left out).
`onActivate` writes the one a person presses on the character
(`CAME_IN_PROPERTY`, `nextCameIn`) with the hold they pressed it from, and a
worldspace with no place of its own wakes them where a death in that hold
would (`came-in-by`); with no door written down it wakes at the fallback
temple, logged `own-world-no-door` or `own-world-no-hold`. `climateOf` still
measures such a worldspace against the mainland's map. Run it with
Build-WorldspaceTable.js, and `--check` says whether both places hold what the
load order says. Older comments named
`respawn-holds.json`; that file never lived in this repository.
`fires.json` is not in the gamemode: it goes into `thornswood-front.js`.

## Deploying it

Everything goes to the dev server first.

- **Dev:** `.\scripts\deploy\Deploy-DevGamemode.ps1`. It checks the file parses with
  `node --check` (`scripts\deploy\Deploy-DevGamemode.ps1:& node --check $Gamemode`)
  before anything leaves the machine, and on a machine without node it refuses,
  as the live deploys do
  (`scripts\deploy\Deploy-DevGamemode.ps1:node is not on this machine, so gamemode.js cannot be checked`). It reads how many are
  on, warns them, sends `gamemode.js` and its `gamemode-tables` folder to
  `C:\Thornswood-Server-Dev`, puts the folder in before the file and waits
  for the load to log both (`scripts\deploy\Reload.ps1:The tables go in first`). `-LoadOrder` brings the dev load
  order up to the built server's; a change to the CHARGEN records needs
  `Deploy-Gamemode.ps1 -Vortex` first (`scripts\deploy\Deploy-DevGamemode.ps1:changes the CHARGEN records needs Deploy-Gamemode.ps1 -Vortex first`).
- **Live:** `.\scripts\deploy\Deploy-Gamemode.ps1` copies `gamemode.js` into the local
  server build (`scripts\release\Where.ps1 ServerDist`, `scripts\deploy\Deploy-Gamemode.ps1:Copy-Item -LiteralPath $Gamemode -Destination (Join-Path $Dist 'gamemode.js')`)
  and writes `server-settings.json` and the load order; it does not talk to
  the VPS (`scripts\deploy\Deploy-Gamemode.ps1:This script does not stop the live server and does not talk to the VPS`). Then `.\scripts\deploy\Deploy-Server.ps1`
  stages the build on the VPS, warns, swaps and restarts
  (`scripts\deploy\Deploy-Server.ps1:game\gamemode.js as the commit holds it`: it takes `gamemode.js` from `game` as committed, not the copy in the build).
  That pair needs the fork built on the machine running it. A gamemode
  change alone needs no build: `.\scripts\deploy\Deploy-Server.ps1 -GamemodeOnly`,
  from any machine, sends the committed `gamemode.js`, its build stamp and
  `Thornswood-Content.esp` when its size changed, and keeps the live server's
  own settings with no key allowed to move. It refuses before anything is sent
  unless the live server runs the server build the commit records
  (`scripts\deploy\Deploy-Server.ps1:refuses unless the box's server-build.json is the record the commit holds`, issue #1089).

Ship does not carry `gamemode.js`. `.\scripts\vps\Check-LiveGamemode.ps1` says
whether the live server runs the file in this repository, by hash.

## Tests that read it

The build check runs every `tests\test-*.js` and `tests\test-*.ps1` harness
that `tests\gate-excluded.txt` does not name (`scripts\dev\Gate-Harnesses.ps1`).
These read `gamemode.js`, most by running one block against a stubbed `mp`.

| Area | Tests |
|---|---|
| Logging and identity | `test-thornswood-log.js`, `test-gamemode-id.js`, `test-build-stamp.ps1` |
| Chargen and arrival | `test-arrivals.js`, `test-arrival-line.js`, `test-creation-close.js`, `test-creation-lines.js`, `test-creation-quiet.js`, `test-dressed-at-creation.js`, `test-new-character.js`, `test-stuck-in-the-hall.js`, `test-1269-kept-character.js` |
| Gathering and mining | `test-deposit.js`, `test-chopping-gate.js`, `test-cooldown-sweep.js`, `test-mine-buildings.js`, `test-farming.js`, `test-eggs.js` |
| Crafting and rules | `test-rulebook.js`, `test-nobody-makes.js`, `test-race-gate.js`, `test-race-table.js`, `test-recipeless-craft.js`, `test-bard-instruments.js`, `test-staff-spells.js`, `test-spell-tomes.js`, `test-enchanter-staff-spells.js`, `test-classes-page.js` |
| Property and economy | `test-deed-title.js`, `test-locks.js`, `test-key-chain.js`, `test-mold-key.js`, `test-cut-key.js`, `test-offices.js`, `test-coffers.js`, `test-2298-box-retired.js`, `test-boards.js`, `test-unpin.js`, `test-spoils.js`, `test-one-mint.js` |
| Needs | `test-needs.js`, `test-temp.js`, `test-food-table.js`, `test-hud.js` |
| Chat, commands, door | `test-command-ack.js`, `test-held-commands.js`, `test-help.js`, `test-tp.js`, `test-dice.js`, `test-door.js`, `test-allowed-failed.js`, `test-audit-handlers.js` |
| Social | `test-social.js`, `test-party-markers.js`, `test-2474-heads.js` |
