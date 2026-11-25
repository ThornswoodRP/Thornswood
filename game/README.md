# The game

## What it is

Everything that runs in the game or on the game server, as opposed to the
scripts that build and ship it:

- `gamemode\`: the server's gamemode, written as TypeScript parts, one per
  system, in the order `gamemode\order.json` lists.
  `node scripts\dev\Build-Gamemode.js` strips their types and joins them into
  `gamemode.js`, the one file of node that the SkyMP server loads. Change a
  part, never `gamemode.js`; the harness test-2181 fails when the two differ.
  `Deploy-DevGamemode.ps1` puts `gamemode.js` on the dev server, and
  `Deploy-Gamemode.ps1` then `Deploy-Server.ps1` on the live one.
- The `.js` files beside `gamemode.js`: plain modules the harnesses can
  require. The server loads only `gamemode.js` and cannot require anything
  beside it, so a builder copies each one into the part that holds its
  markers. The table under "The sources beside the gamemode" says which.
- `plugins\`: the Skyrim Platform plugins that run in each person's game.
  Its own README says how they are written.
- `ui\`: the overlays and the page the plugins draw in the game's browser.
  Its own README too.
- `data\`: the tables the gamemode and the content build read. The table
  under "The tables in `data`" names each one that is committed.
- `content\Thornswood-Content.esp`: our plugin file. It is not kept here.
  Since #5191 nothing generated is committed: the box builds the plugin and
  every table at deploy (`scripts\mods\Build-ContentOnBox.ps1`), and a
  checkout lays that build with `scripts\release\Get-ContentBuild.ps1 -Newest`
  (or `-Take` for its own commit's). People get the plugin through the Nexus
  collection.
- `data\last-plugin.recipe`: the recipe for Thornswood-Last.esp, the light
  plugin that loads last (#2468), built with the rest of the content build
  by `scripts\mods\Build-LastPlugin.py` and never committed. The plugin
  switches off every placed actor the NPC catalogue cuts and stops every
  vanilla quest from starting, except the creature voices
  `data\last-plugin-policy.json` keeps, and the mod quests it names with
  gate, door or arrival talk. It copies other authors' records, so since
  #2791 no repository holds the plugin: every pack carries the recipe with a
  plugin list that enables the plugin last, the launcher makes the plugin
  from it and the person's own plugins before every Play, and the deploys
  make the servers' copy on the box (`scripts\deploy\LastPluginOnBox.ps1`).
- `required-data\`: plugins the load order names that Vortex does not yet
  deploy under that exact filename. Go.ps1 and Ship place them into `Data\`.
  Its own README says when to take one out.
- `menu\` and `ours\`: files Thornswood puts in the game folder itself. Each
  is named in its table below.

## `menu`

What `Go.ps1` copies into the game folder for Skyrim's main menu.

| File | What it is |
|---|---|
| `logo.nif` | The logo mesh on the main menu |
| `logo01ae.nif` | The same for the Anniversary Edition's menu |
| `Mainmenuwallpaper.dds` | The wallpaper behind the main menu |

## `ours`

Each file keeps its path under `Data\`, and `Go.ps1` and the packs copy that
path into the game folder.

| File | What it is |
|---|---|
| `Data\Interface\loadwaitspinner.swf` | The empty loading spinner |
| `Data\Interface\skyhud\skyhud.txt` | SkyHUD's settings |
| `Data\Interface\Translations\Thornswood-Content_ENGLISH.txt` | The names of our plugin's crafting categories |
| `Data\SKSE\Plugins\CraftingCategories\Thornswood-Content.json` | Which crafting category each of our plugin's recipes is in |
| `Data\SKSE\Plugins\QuickLootIE.json` | QuickLoot IE's settings |
| `Data\Platform\Fonts\Barlow-SemiBold.spritefont` | The sprite font the voice mark draws in, written by `scripts\mods\Build-SpriteFont.py` |
| `Data\Platform\Fonts\Barlow-SemiBold-OFL.txt` | The licence that font goes out under |
| `Data\music\special\mus_maintheme.xwm` | A silent stand-in for the game's theme |

## The sources beside the gamemode

Each builder writes its sources into the part of `gamemode\` that holds its
markers. Edit the source, run the builder, then `Build-Gamemode.js`.

| Source | Into the gamemode by |
|---|---|
| `merchant-trading.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `merchant-settlement.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `merchant-commission-state.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `merchant-commissions.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `merchant-ledger-native.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `merchant-role-stage.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `kill-contracts.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `quest-transactions.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `quest-eligibility.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `quest-resource-sources.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `quest-items.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `quest-mammoth-sources.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `quest-hunt-bundles.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `quest-orchard-plots.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `scene-reward-budget.js` | `scripts\dev\Build-MerchantGamemode.js` |
| `trade-cargo.js` | `scripts\dev\Build-TradeCargoGamemode.js` |
| `trade-ship-dock.js` | `scripts\dev\Build-TradeCargoGamemode.js` |
| `trade-carts.js` | `scripts\dev\Build-TradeCargoGamemode.js` |
| `market-stalls.js` | `scripts\dev\Build-MarketStallsGamemode.js` |
| `hair-dye.js` | `scripts\dev\Build-HairDyeGamemode.js`, with `data\hair-dyes.json` |
| `trading-company.js` | `scripts\dev\Build-TradingCompanyGamemode.js`, with `data\trading-company.json` |
| `form-id.js` | not part of the gamemode: the original of the form id helpers, which `tests\test-2870-form-id-shape.js` holds every copy to |
| `merchant-roster-admission.js` | not part of the gamemode: only its harness, `game\tests\test-merchant-ledger-inspection.js`, requires it |
| `quest-fishing-sources.js` | not part of the gamemode: only its harness, `game\tests\test-quest-fishing-sources.js`, requires it |

## The tables in `data`

Only the tables written by hand, or by a script run by hand, are committed.
Every table the box's content build writes is a step's output in
`scripts\mods\content-tables.json`, the one list of them, and `.gitignore`
names each one so it is never committed; `tests\test-5191-leave-git.ps1`
holds the two to each other. The gamemode's own tables from that build go to
`gamemode-tables\`, which is not committed either.

| Table | Written by |
|---|---|
| `data.json` | by hand |
| `items.json` | by hand |
| `chargen.json` | by hand |
| `food-groups.json` | by hand |
| `furniture.json` | by hand |
| `guild-sites.json` | by hand |
| `hair-dyes.json` | by hand |
| `last-plugin-policy.json` | by hand |
| `merchant-orchard.json` | by hand |
| `merchant-quest-activation.json` | by hand |
| `merchant-quests.json` | by hand |
| `merchant-ranked-quests.json` | by hand |
| `merchant-roster.json` | by hand |
| `merchant-scarce-fishing.json` | by hand |
| `property-word.json` | by hand |
| `quest-content.json` | by hand |
| `stations.json` | by hand |
| `thalmor-patrols.json` | by hand |
| `trading-company.json` | by hand |
| `war-stages.json` | by hand |
| `cut-items.json` | `scripts\dev\Write-CutItems.js` |
| `cut-kept.json` | `scripts\dev\Write-CutItems.js` |
| `merchant-traders.json` | `scripts\dev\Build-NpcPopulation.py --write-runtime` |
| `mine-buildings.json` | `scripts\dev\Measure-MineBuildings.py --out game\data\mine-buildings.json` |
| `NPC-SPAWNS.csv` | `scripts\dev\Build-NpcPopulation.py --write-runtime` |
| `station-sites.json` | `scripts\dev\Build-StationSites.py` |

## On your machine

`.\scripts\release\Go.ps1 -SkipServer` copies the plugins, the overlays, the menu
and our menu files into the game folder, which is how a change here reaches your own game.
Every harness that checks the gamemode reads `gamemode.js` from here. The
ones that read only the game are beside it in `game\tests\`, and the ones
that read the game and another product are in `tests\`.
`tests\test-4436-game-readme.js` fails when a file under `ours\`, `menu\`,
`data\` or beside `gamemode.js` is not named in this README.

## Where it runs

The plugins, the overlays and the menu go out in the release packs; the
gamemode and the content plugin go to the server. Moved here from `tools\`
on 25 September (issue #440, phase 6); the comments inside these files still
say `tools\` in places, because changing them would change what ships.
