# Where Thornswood stands its benches, kilns, salt quarries, hives and labs (#516, #2553)

Patrick, 16 Oct 2026, A on #2553: Thornswood measures its own spots for the charcoal kiln, the salt quarry, the beehive and the alchemy lab, the way the woodworking benches were placed ([Woodworking benches](#woodworking-benches-516), below), and `Thornswood-Content.esp` places them. Until then the only placed kilns, salt quarries, placed hives and Thornswood labs were 57 placements salvaged from another server's plugin, at the spots it chose. Those are gone.

## How it is done

- `scripts/dev/Build-StationSites.py` reads the collection's plugins in the load order of `game/data/last-plugin.json` and measures each spot. It writes `game/data/station-sites.json`: every site's anchor, its point and angle, the ground under it, the nearest solid thing, the cell it stands in and why the plugin's copy of that cell changes nothing, and every site left out with why.
- `scripts/mods/Add-ContentRecords.py` writes one placement for each row of that table, its base, point and turn and nothing else, under the form id the row gives (from `0x05015500`, which no version of the plugin ever used).
- `game/tests/test-2553-station-sites.js` holds the table to its rules, and on a machine with the game reads the plugins again. `game/tests/test-2553-salvaged-gone.js` holds the plugin to the table and proves nothing salvaged is left.

## The rule for each kind

The rulebook says what each station is for and who works it, and names no town. So each kind has one rule, chosen from what the station is for.

- **Charcoal kiln** ([charburner.md](professions/woodworker/charburner.md)): the kiln turns the firewood a woodworker splits at a chopping block into the charcoal every forge burns. One for each of the nine towns with a woodworking bench, outside the town: beside the chopping block in the open world nearest that town's forge, among those 1,000 units or more from every bench (#2337) and within 12,000 units of the forge, or 20,000 for Solitude and Markarth, whose nearest blocks are at Katla's Farm and Salvius Farm. A kiln may stand among small plants, the way Skyrim's smelters do: thickets, shrubs, ferns and flowers no larger than 250 units a side, never a crop plot (Patrick, 17 Oct, B on #2553).
- **Salt quarry** ([miner.md](classes/miner.md)): salt comes from the sea. One on the shore of each hold capital on the Sea of Ghosts (Solitude, Windhelm, Dawnstar, Winterhold), beside the boat drawn up nearest the town, within 12,000 units. The quarry is an ore vein, so it is set into rock the way Skyrim's veins are (Patrick, 17 Oct, B on #2553): only the place the miner stands needs clear, dry, flat navmesh, no more than 240 units above the sea. The vein may run into rocks, cliffs and plants, but nothing else, and every part of it lies on ground no more than 16 units under it and above the water, or inside a rock or cliff, so it never hangs over a drop or the sea.
- **Beehive** ([farmer.md](classes/farmer.md)): a placed hive is a farmer verb. One at each of Skyrim's own named farms (a location Skyrim marks as a farm) with at least 5 crop plots of the farmer's table within 2,400 units, the farm claim's circle, of the farm's point: its map marker, or the farmhouse's outside door where that marker is inside the house. It stands beside the crop plot nearest that point.
- **Alchemy lab** ([physicker.md](professions/alchemist/physicker.md), [injury.md](injury.md)): the poultice and the remedy are made only at Thornswood's lab. One in the apothecary of each of the nine hold capitals, beside Skyrim's own lab there; Winterhold has no apothecary in town, so the College's Hall of Countenance; Windhelm's Palace of the Kings is tried after the White Phial.
- **Well bucket** ([drink.md](drink.md)): water is drawn at a well by activating it (Patrick, 12 Oct, #1382), and every placed well in the load order is a static, which the game never lets anybody activate. So one bucket beside each of the 30 placed wells in `game/data/wells.json`, the nearest clear spot within 400 units of the well. Activating it fills an empty bottle with well water. A well in a cell that no master of the content plugin carries (the two in the sewers) is left out, since the plugin can only place into its masters' cells.
- **Water bucket** ([drink.md](drink.md)): drawing spots at rivers and lakes (Patrick, 12 Oct, #1382). One for each of the nine towns with a forge, on the river nearest it, or for Riften on Lake Honrich: the nearest clear spot to the forge within 3,000 units whose cell's water `game/data/waters.json` classes as a river (for Riften, the deep water of the lake), at its edge: ground no lower than the water and no more than 120 units above it, with navmesh under the water within 160 units, so the water is there to reach. Lake water is worth what river water is (Patrick, 20 Oct), so one bucket serves both, and the water drawn there must be boiled.
- **Study desk** ([magic.md](magic.md)): a semester at the College is taken at a study desk in the College halls, not a command (Patrick, 22 Oct, A on #1387). Skyrim's desks are statics, which nobody can activate, so the plugin stands an activator wearing Skyrim's NobleDesk01. One in each of the four halls, the Hall of the Elements, the Hall of Countenance, the Hall of Attainment and the Arcanaeum, the nearest clear spot within 900 units of the hall's own reading tables (the Hall of the Elements has only benches), measured off the cells by `scripts/dev/List-CellRefs.py`. Pressing E at it is the semester.

Each rule gives its anchors nearest first. The builder searches round each in turn, every step out to the kind's reach in eight turns, and takes the nearest clear spot; the first anchor with one wins.

## What holds a spot clear

The same measure as the benches, but where the rule above lets a kiln stand among plants or sets a vein into rock. The station's outline and the place somebody stands to use it lie on the winning navmesh, on ground flat to the kind's tolerance (a bench and a lab 8 or 16 units, a hive 40, a kiln 48, a quarry 32: the far side sinks into a slope, never floats), within 60 units of the anchor's height, out of doors above the water. Nothing overlaps it: no furniture, container, door, plant, item or small static, nor where somebody stands at other furniture, the way through a door, a woodworking bench, a notice board and its drop box, or another station, with 30 units to the nearest solid thing. The cell it stands in is copied from Bethesda's own record, and only where that copy changes nothing: a later plugin carries the cell too, or the record that wins without the content plugin is Bethesda's own, field for field. A spot in a cell a mod changes before the content plugin is refused.

## Where they stand, 17 Oct 2026

29 placements: 5 kilns, 4 salt quarries, 12 hives and 8 labs. `game/data/station-sites.json` has every number.

### Charcoal kilns (5)

| Where | Beside | Cell | From its anchor |
| --- | --- | --- | --- |
| Dawnstar | a chopping block in the town | Dawnstar03Exterior | 592 units |
| Morthal | the chopping block at the lumber mill | MorthalExterior05 | 387 units |
| Riverwood | a chopping block in the village | Riverwood | 382 units |
| Whiterun | the chopping block outside the walls | WhiterunExterior14 | 945 units |
| Windhelm | the chopping block by the bridge | WindhelmBridge01 | 998 units |

### Salt quarries (4)

| Where | Beside | Cell | From its anchor |
| --- | --- | --- | --- |
| Dawnstar | a rowboat on the shore by the town | Dawnstar03Exterior | 1,255 units |
| Solitude | a longboat at the docks | `929a:Skyrim.esm` | 1,553 units |
| Windhelm | a rowboat at the docks | WindhelmDocksExterior01 | 781 units |
| Winterhold | a rowboat on the shore below the town | `8e66:Skyrim.esm` | 1,270 units |

### Beehives (12)

| Where | Cell | From its anchor plot |
| --- | --- | --- |
| Brandy-Mug Farm | BrandyMugFarmExterior | 272 units |
| Chillfurrow Farm | `9617:Skyrim.esm` | 439 units |
| Corpselight Farm, Falkreath | FalkreathExterior01 | 1,152 units |
| Cowflop Farm, Rorikstead | RoriksteadExterior03 | 1,133 units |
| Hlaalu Farm | `b4d9:Skyrim.esm` | 432 units |
| Hollyfrost Farm | HollyfrostFarmExterior | 439 units |
| Katla's Farm | KatlasFarmExterior | 272 units |
| Lemkil's Farm, Rorikstead | RoriksteadExterior03 | 280 units |
| Loreius Farm | LoreiusFarmExterior | 437 units |
| Pelagia Farm | WhiterunExterior16 | 496 units |
| Salvius Farm | LeftHandMineExterior02 | 780 units |
| Snow-Shod Farm | SnowShodFarmExterior | 766 units |

### Alchemy labs (8)

| Where | From Skyrim's own lab |
| --- | --- |
| Angeline's Aromatics, Solitude | 587 units |
| Arcadia's Cauldron, Whiterun | 178 units |
| Elgrim's Elixirs, Riften | 131 units |
| Grave Concoctions, Falkreath | 256 units |
| Thaumaturgist's Hut, Morthal | 124 units |
| The College's Hall of Countenance, Winterhold | 276 units |
| The Hag's Cure, Markarth | 196 units |
| The Mortar and Pestle, Dawnstar | 166 units |

### Well buckets (18), 20 Oct 2026

Each row is the well the bucket stands beside, by its base and cell, as the table names it.

| Well | From the well |
| --- | --- |
| ImpWell01 in 9722:Skyrim.esm | 244 units |
| ImpWell01 in BloatedMansRuins | 115 units |
| FarmWell01 in DLC1RedwaterDen01 | 176 units |
| FarmBWellEnt01 in DLC2HrodulfsHouse | 96 units |
| RedoranWell01 in DLC2RavenRock02 | 272 units |
| GenericWell01 in DushnikhYalExterior02 | 115 units |
| FarmBWellEnt01 in FalkreathBarracksJail | 32 units |
| FarmWell01 in FalkreathExterior02 | 181 units |
| ImpWell01 in FellglowKeepExterior02 | 145 units |
| ImpExtIceWell01 in FortDunstadExterior02 | 113 units |
| ImpExtIceWell01 in FortNeugradExterior04 | 145 units |
| ImpWell01 in FortSnowhawkExterior04 | 173 units |
| ImpWell01 in FortSungardExterior01 | 144 units |
| ImpExtIceWell01 in FrostflowLighthouseExterior01 | 112 units |
| ImpWell01 in POIPineForest08 | 143 units |
| FarmWell01 in POITundra08 | 80 units |
| RTPlazaWell01 in RiftenOrigin | 284 units |
| ImpWell01 in TrevasWatchExterior01 | 222 units |

### Water buckets (2), 20 Oct 2026

| Where | Cell | From the forge |
| --- | --- | --- |
| Lake Honrich at Riften | RiftenOrigin | 754 units |
| the river at Riverwood | Riverwood02 | 2,338 units |

### Study desks (4), 26 Oct 2026 (#1387)

| Where | Beside | From its anchor | Nearest solid thing |
| --- | --- | --- | --- |
| the Arcanaeum, the College of Winterhold | a square reading table | 135 units | that table, 42 units |
| the Hall of Attainment, the College of Winterhold | the round table | 118 units | a barrel, 33 units |
| the Hall of Countenance, the College of Winterhold | the square table on the lower floor | 138 units | a wall shelf, 39 units |
| the Hall of the Elements, the College of Winterhold | a bench | 234 units | that bench, 31 units |

Measured on the box on 26 Oct, when the station table first read the floor items Thornswood-Last.esp switches off (#3077) as nothing in the way. Three spots measured before that moved within their cells: Arcadia's Cauldron's lab, and the well buckets at Hrodulf's House and in POITundra08.

### Where the rule led to the other server's spot

Elgrim's Elixirs' lab stands 114 units from where the other server's stood, Arcadia's Cauldron's 610 and Angeline's Aromatics' 569: the rule puts a lab beside Skyrim's own, and so did that server. Riverwood's kiln is 829 units from that server's Riverwood kiln and Chillfurrow's hive 950 from one of its two there; Rorikstead's two hives stand in the cell where it had one, 1,355 and 2,215 units from it. The four salt quarries are nowhere near its salt quarries. Every other spot is somewhere it never placed anything.

## Left out, and why

Nothing is placed where the measure refuses every spot. Measured over the same load order after Patrick's B; `game/data/station-sites.json` lists every anchor tried and the counts of what refused it.

- Charcoal kiln, Markarth: no usable chopping block stands in the open world within 20,000 units of the forge. Salvius Farm's (15,707 units) has an enable parent, so it is not always there.
- Charcoal kiln, Solitude: Katla's Farm's chopping block, the only one within 20,000 units, has no clear, flat navmesh of the kiln's 441 by 535 units beside it, even among plants: refused mostly for off the navmesh, the wheat field, and the farm's own furniture.
- Charcoal kiln, Falkreath and Riften: none of the chopping blocks nearest the town has that ground beside it; refused mostly for off the navmesh, slopes, rocks and fences, and at Falkreath the bench's 1,000 units.
- Beehive, Battle-Born Farm, Dragon Bridge Farm, Merryfair Farm and Sarethi Farm: none of the crop plots nearest the farm has clear, flat ground beside it; refused for thickets, fences, slopes and, at Battle-Born and Sarethi, cells that JK's Whiterun's Outskirts and Water for ENB change before the content plugin.
- Alchemy lab, The White Phial, Windhelm: neither the White Phial nor the Palace of the Kings has a lab's floor clear beside Skyrim's own.
- Well buckets, 12 of the 30 wells left without one of their own. A spot in a cell a mod changes before the content plugin is refused, so the copy of the cell never undoes the mod's edit; two wells side by side share one bucket:
  - DLC2SkaalVilFarmWell01 in 142ec:Dragonborn.esm: no clear spot within 400 units beside it (5446 the ground runs # to #; 3135 its cell eda3:Dragonborn.esm: Embers XD.esp changes it before the content plugin; 2944 off the navmesh; 1901 touches FishRack01).
  - FarmWell01 in 965b:Skyrim.esm: no clear spot within 400 units beside it (4380 its cell 965b:Skyrim.esm: ElysiumEstate.esp changes it before the content plugin; 2137 off the navmesh; 2066 touches DLC1TreeFloraMountainFlower01Yellow; 1219 touches TreeFloraHangingMoss02).
  - FarmWell01 in 9ad9:Skyrim.esm: no clear spot within 400 units beside it (6766 its cell 9ad9:Skyrim.esm: aaaGraniteHill.esp changes it before the content plugin; 2468 off the navmesh; 1326 touches CommonBench01; 906 touches TreeClover01).
  - FarmBWell01 in FalkreathBarracksJail: no clear spot within 400 units beside it (10361 off the navmesh; 3490 touches FXcobwebDangle01; 1580 touches FXcobwebDangle02; 257 touches PortGatePole01).
  - ImpWell01 in FortGreenwall04: no clear spot within 400 units beside it (12503 off the navmesh; 3185 touches RiftenRWHallLadderDoor01, its way through).
  - ImpWell01 in FortGreymoorExterior03: no clear spot within 400 units beside it (10633 its cell 99e8:Skyrim.esm: Embers XD.esp changes it before the content plugin; 3868 off the navmesh; 767 touches ImpDoorDoubleLoad01, its way through; 237 touches Bucket01).
  - ImpWell01 in FortSungardCourtyard: the well 352a9:Skyrim.esm is not placed, or is switched off or has an enable parent.
  - FarmWell01 in POITundra08: it shares the bucket of well-23, 80 units away.
  - GenericWell01 in SSewersSolitude02: the well 27172:SkyrimSewers.esp stands in a cell of skyrimsewers.esp, which is not a master of Thornswood-Content.esp.
  - FarmBWell01 in SSewersWRBurrow: the well 3907d:SkyrimSewers.esp stands in a cell of skyrimsewers.esp, which is not a master of Thornswood-Content.esp.
  - FarmBWell01 in WindhelmMarketplaceExterior: no clear spot within 400 units beside it (7841 off the navmesh; 3061 touches ImpExtBlocks01SnowLight; 1861 touches TreeFloraHangingMoss01; 1151 touches FishRack01Light_SNWH).
  - RTPlazaWell01 in bcd0:Skyrim.esm: no clear spot within 400 units beside it (15688 off the navmesh).
- Water buckets, 7 of the 9 left out: no river water, or for Riften lake water, within 3,000 units of the forge that has a clear spot at its edge. Whiterun's and Markarth's streams are placed water the records do not class as a river cell, and Windhelm's and Solitude's nearest water is the sea's:
  - the river at Dawnstar: 98048 not by river or lake water.
  - the river at Falkreath: 97936 not by river or lake water; 64 touches TreeThicket01; 47 off the navmesh; 1 not at the water's edge.
  - the river at Markarth: 98048 not by river or lake water.
  - the river at Morthal: 98048 not by river or lake water.
  - the river at Solitude: 98048 not by river or lake water.
  - the river at Whiterun: 98048 not by river or lake water.
  - the river at Windhelm: 98048 not by river or lake water.
- Lod's house in Falkreath, which Skyrim marks as a farm, has 3 crop plots near its door: a smith's yard, not a field, so no hive.

To change one: edit the kind's rule or a site in `SITES` in `scripts/dev/Build-StationSites.py`, run it with `--data <the game's Data>`, then `python scripts/mods/Add-ContentRecords.py --masters <the game's Data>`, then `pwsh scripts/mods/Rebuild-ContentTables.ps1`, which rebuilds every table read out of the load order, in the order `scripts/mods/content-tables.json` gives, and the plugin's hash in `records/asset-provenance.json`. From a cloud thread all three run on the box with main's scripts: `pwsh scripts/vps/Box-Run.ps1 -Line 'Rebuild-ContentTables -Stations -Pull <number> -Head <its full head commit>'`.

## Woodworking benches (#516)

Patrick, 12 Oct 2026: our own woodworking bench, at least one in every major hold and some minor towns, placed by Claude.

### Base records

- KYWD `ThornswoodCraftingWoodworking` (0x050154E1) in `Thornswood-Content.esp`
- FURN `ThornswoodCraftingWoodworkingWorkbench` (0x050154E2), mesh `_BYOH\Furniture\CraftingWorkbench01.nif` (Hearthfire carpenter workbench), create-object bench, carries the keyword above

### Where they stand, 16 Oct 2026

The server stands the benches, once, when it starts, beside a fixed forge read out of the plugins: the same way the notice boards stand (#2516). No plugin places them, and nothing on a timer moves them back.

- `scripts/dev/Build-WoodworkingBenches.py` reads each forge's winning record over the whole load order in `game/data/last-plugin.json`, and works out the bench's point, height and angle from an offset in that forge's own frame. It stops on a site whose spot is not clear: the bench and the place its woodworker stands must lie on the town's navmesh, on ground flat to 16 units and within 60 of the forge's own height, touch no furniture, container, door, item or small static, and keep 30 units from the nearest of them.
- `game/data/woodworking-benches.json` is what it measured at each spot: the forge and every plugin that touches it, the point and angle, the ground under the bench, the nearest solid thing and why the spot was chosen.
- The gamemode's `WOODWORKING_BENCHES` block is that table; `standBenches()` in the property block stands them at start.
- `game/tests/test-516-woodworking-benches.js` holds all of it together, and on a machine with the game reads the plugins again.

| Town | Forge | Bench from the forge | Nearest solid thing |
| --- | --- | --- | --- |
| Whiterun | Warmaiden's, `c430a:Skyrim.esm` (not the Skyforge) | 668 units, north of Warmaiden's shop by its wall, on the forge's floor | a decorative shield, 30 units |
| Solitude | Beirand's, `4e3e9:Skyrim.esm` | 201 units, behind the smith in the open yard | the smelter, 34 units |
| Windhelm | the blacksmith yard by the gate, `f7798:Skyrim.esm` | 260 units, behind the smith | the grindstone, 53 units |
| Markarth | Ghorza's, `514d8:Skyrim.esm` | 743 units, on the walk a step below the forge | a fern, 34 units |
| Riften | The Scorched Hammer, `53481:Skyrim.esm` | 260 units, to the smith's right on the same boards | a signpost, 70 units |
| Falkreath | Lod's, `99b8a:Skyrim.esm` | 388 units, to the smith's left | a lean spot on the wall, 40 units |
| Dawnstar | Rustleif's, `cadf6:Skyrim.esm` | 449 units, behind the smith | a barrel, 31 units |
| Morthal | JK's Skyrim's anvil, `24588:JKs Skyrim.esp` (Morthal has no forge of Skyrim's own) | 418 units, to the smith's left | a fire pit, 53 units |
| Riverwood | Alvor's, `d6987:Skyrim.esm` | 400 units, to the smith's left, nowhere near the kiln | a lean spot on the wall, 44 units |

Three sites moved on 16 Oct (#2553). Until then the other server's records in Thornswood-Content.esp moved and turned Whiterun's and Riften's forges and shrank and moved Windhelm's tanning rack. With those records gone, Skyrim's own forges and rack stand where Skyrim puts them: Whiterun's bench keeps its spot, measured from the forge where it now stands; Riften's forge stands on the old spot, so the bench is beside it; Windhelm's rack is back beside the old spot, so the bench is behind the smith.

No bench, and why, measured over the same load order:

- Winterhold: no forge. JK's Skyrim's anvil stands inside a shack of its own, with no clear flat ground of the bench's size beside it.
- Rorikstead: no forge of Skyrim's own. JK's Skyrim's anvil yard sits on a raised ledge with no clear flat ground of the bench's size on it.
- Ivarstead: no forge and no anvil at all.
- Dragon Bridge: its forge stands on sloping ground; the nearest clear flat spot is 725 units away out in the field.

Never at the charcoal kiln (#2337): the harness refuses any bench within 1,000 units of one.

To move one: `python scripts/dev/Build-WoodworkingBenches.py --search <town>` lists the clear spots round its forge, nearest first. Change the town's offset or turn in SITES, run the builder without `--search`, and run the harness.

### Still to do

Nothing for the woodworking recipes. The Woodwright's recipes that sat at the forge in plugins loading after Thornswood-Content.esp are moved to the woodworking bench by Thornswood-Last.esp (#3120); the trailing plugin once planned for them never shipped and is gone.
