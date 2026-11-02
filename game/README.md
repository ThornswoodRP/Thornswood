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
- `plugins\`: the Skyrim Platform plugins that run in each person's game.
  Its own README says how they are written.
- `ui\`: the overlays and the page the plugins draw in the game's browser.
  Its own README too.
- `data\`: the tables the gamemode's generated blocks are built from (doors,
  fires, food, harvests, hunts, ores, races, recipes, spells, stations,
  warmth, water, weather, cast, the mine buildings, plus `data.json`,
  `items.json` and `chargen.json` for the one-line `DATA` / `ITEMS` / `CHARGEN`
  consts). The `Build-*Table` scripts in `scripts\dev\` and
  `Install-GamemodeConsts.js` read these and write the matching block or const
  line in `gamemode.js`; nothing reads them at run time.
- `content\Thornswood-Content.esp`: our plugin file. People get it through
  the Nexus collection; the dev and live deploys send it to the server.
- `data\last-plugin.recipe`: the recipe for Thornswood-Last.esp, the light
  plugin that loads last (#2468). The plugin switches off every placed actor
  the NPC catalogue cuts and stops every vanilla quest from starting, except
  the creature voices `data\last-plugin-policy.json` keeps, and the mod quests
  it names with gate, door or arrival talk. Built only by
  `scripts\mods\Build-LastPlugin.py` from the installed load order, never in
  an editor; `data\last-plugin.json` is what it holds, and
  `tests\test-2468-last-plugin.js` holds the two together. It copies other
  authors' records, so since #2791 no repository holds the plugin and nothing
  hands it on: Build-LastPlugin.py writes the recipe, every pack carries the
  recipe with a plugin list that enables the plugin last, the launcher makes
  the plugin from it and the person's own plugins before every Play, and the
  deploys make the servers' copy on the box (`scripts\deploy\LastPluginOnBox.ps1`)
  and put it last in their load order. A release refuses a recipe built
  against other bytes than the release's own plugins, so a new collection
  revision means building it again.
- `required-data\`: plugins the load order names that Vortex does not yet
  deploy under that exact filename. Go.ps1 and Ship place them into `Data\`.
  Its own README says when to take one out.
- `menu\`: the two logo meshes and the wallpaper behind Skyrim's main menu,
  which `Go.ps1` copies into the game folder.
- `ours\`: the main menu with no Bethesda logo, the empty loading spinner,
  the silent stand-in for the game's theme, and SkyHUD's settings. Each
  file keeps its path under `Data\`, beside `menu\`, and `Go.ps1` copies
  that path into the game folder.

## On your machine

`.\scripts\release\Go.ps1 -SkipServer` copies the plugins, the overlays, the menu
and our menu files into the game folder, which is how a change here reaches your own game.
Every harness in `tests\` that checks the gamemode reads `gamemode.js` from
here.

## Where it runs

The plugins, the overlays and the menu go out in the release packs; the
gamemode and the content plugin go to the server. Moved here from `tools\`
on 25 September (issue #440, phase 6); the comments inside these files still
say `tools\` in places, because changing them would change what ships.
