"""
Build-StationSites.py

Works out where Thornswood-Content.esp places Thornswood's own stations, the
charcoal kiln, the salt quarry, the beehive and the alchemy lab, from the
plugins, and writes it down in game\\data\\station-sites.json.
scripts\\mods\\Add-ContentRecords.py places them from that table.

WHY (#2553)

Until 16 October the only placed kilns, salt quarries, placed hives and
Thornswood labs were 57 placements salvaged from another server's plugin,
each where that server put it. Patrick, 16 October 2026, A on #2553:
Thornswood measures its own spots for them, the way the woodworking benches
were placed (#516, scripts\\dev\\Build-WoodworkingBenches.py), and the content
plugin places them. The 57 go, and the plugin holds nothing of the other
server's.

WHERE EACH KIND GOES, AND WHY (docs\\systems\\station-placement.md says the
same in prose). The rulebook names what each station is for and who works it;
it names no town. So each kind has one rule, chosen from what the station is
for, and SITES below is that rule worked out. The builder checks each site
against its rule and stops on one that does not follow it.

  kiln     docs\\systems\\professions\\woodworker\\charburner.md: the kiln turns
           firewood, which a woodworker splits at a chopping block, into the
           charcoal every forge burns. So one kiln for each of the nine towns
           with a woodworking bench, outside the town: beside the chopping
           block in the open world (Tamriel, not a walled city's own
           worldspace) nearest that town's forge, among those 1,000 units or
           more from every bench (#2337), within 12,000 units (20,000 for
           Solitude and Markarth). A kiln is the size of Skyrim's smelter,
           and no walled city has that much clear ground by a block; like a
           smelter it may stand among small plants (Patrick, B on #2553).
  salt     docs\\systems\\classes\\miner.md: the salt quarry. Salt comes from
           the sea, so one quarry on the shore of each hold capital that
           stands on the Sea of Ghosts (Solitude, Windhelm, Dawnstar,
           Winterhold), beside the boat drawn up nearest the town: its forge
           for the first three, its smithing anvil for Winterhold, which has
           no forge. The quarry is an ore vein, set into rock the way
           Skyrim's veins are: only where the miner stands needs clear, dry,
           flat ground (Patrick, B on #2553).
  hive    docs\\systems\\classes\\farmer.md: a placed hive is a farmer verb.
           So one hive at each of Skyrim's own named farms (a location Skyrim
           marks as a farm) that has at least 5 crop plots of the farmer's
           table within 2,400 units, the farm claim's circle, of the farm:
           its map marker, or the farmhouse's outside door where that marker
           is inside the house. The hive stands beside the crop plot nearest
           that point.
  lab      docs\\systems\\professions\\alchemist\\physicker.md and injury.md:
           the poultice and the remedy are made only at Thornswood's lab.
           So one lab in the apothecary of each of the nine hold capitals,
           the shop Skyrim marks as a store that has Skyrim's own alchemy lab,
           beside that lab. Winterhold has no apothecary in town, so its lab
           is in the College's Hall of Countenance, beside the lab there.
  study    docs\\systems\\magic.md: a semester at the College is taken at a
           study desk in the College halls (Patrick, 22 October 2026, A on
           #1387). So one desk in each of the four halls, the Hall of the
           Elements, the Hall of Countenance, the Hall of Attainment and the
           Arcanaeum, beside the tables or benches SITES names in that hall,
           where the College's own reading furniture stands.

NO COORDINATE IN HERE IS TYPED FROM THE GAME. Each site's rule gives its
anchors, nearest first: the chopping blocks or boats nearest its town (within
TOWN_REACH), the crop plots nearest its farm, or the labs SITES names. Each is
a reference of Skyrim's or of a mod in the load order that never moves. For
each anchor in turn the builder searches round it, every step units out to
the kind's reach in eight turns of the anchor's own angle, and takes the
nearest clear spot, a turn costing as much as 60 units of distance; the first
anchor with one wins, and the anchors passed over are written down with why.
When no anchor has a clear spot, the site is left out with every anchor tried
and why (skipped in the table), the way the benches skip a town (#516):
nothing is placed where the measure refuses every spot. The point, the height
and the angle come out of the anchor's winning record over the load order.

WHAT HOLDS A SPOT CLEAR, the same measure as the woodworking benches:

  The ground. The station's outline and the place somebody stands to use it
  are sampled every 16 units (32 for the kiln and the quarry, which are four
  times a bench's size). Every sample lies on the winning navmesh of that
  worldspace or cell, within the kind's flat of every other sample (the far
  side sinks that far into a slope, never floats) and within 60 units of the
  anchor's height; on the shore, between the sea and 240 units above it. The
  station stands on the lowest sample. Out of doors every sample lies above
  the water of its cell.

  Nothing in the way. No furniture, container, door, activator, plant, item
  or small static overlaps it (each one's bounds, turned and scaled as it is
  placed) between 6 and 140 units above its floor, and the nearest is at
  least 30 units away. Nor the place somebody stands at any other furniture,
  the way through a door, a woodworking bench the server stands (#516), a
  notice board and its drop box (#2516), or another of these stations. Larger
  statics and anything over 600 units on a side are the navmesh's to answer
  for. Thornswood-Content.esp's own placements of these four stations are not
  obstacles: they are what this places.

  A kiln stands at least 1,000 units from every woodworking bench (#2337).

  The cell. The plugin has to carry the cell a placement stands in, and the
  worldspace of an exterior, copied from Bethesda's own record. That copy
  must change nothing in the game: either a plugin after the content plugin
  carries the same record, so the copy never wins, or the record that wins
  without the content plugin is Bethesda's own, field for field. A spot in a
  cell a mod changes is refused, so the copy never undoes a mod's edit.

WHAT IT READS. The collection's plugins in game\\data\\last-plugin.json's load
order, from --data, and from the repository's Thornswood-Content.esp only the
four station records: their bounds are the stations' outlines. It does not
read Thornswood-Last.esp, and it checks that it places nothing new: only the town gates it unlocks,
the floor items it switches off and the hold-only plants and ores it switches off outside their
hold (#3150), where they stand. It reads the benches' spots out of
game\\data\\woodworking-benches.json and the boards' out of game\\gamemode.js.

WHAT IT WRITES. game\\data\\station-sites.json: every site's anchor, the spot,
its angle, the ground under it, the nearest solid thing, the cell and
worldspace records the plugin carries and why each copy changes nothing, the
placement's form id, and every plugin read with its size and sha256. It does
not hash Thornswood-Content.esp, which is written from this table.

Read only apart from that file. --check writes nothing and fails when the
table is not what the plugins give now.

Usage:
    python scripts/dev/Build-StationSites.py --check --data <the game's Data>
    python scripts/dev/Build-StationSites.py --data <the game's Data>
"""

import argparse
import importlib.util
import io
import json
import math
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import own_plugins  # noqa: E402


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# The bench builder's plugin reader, load order and geometry, and the last
# plugin's record copier: one reader for every placement Thornswood measures.
wb = _module('build_woodworking_benches', os.path.join(HERE, 'Build-WoodworkingBenches.py'))
last = _module('build_last_plugin', os.path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py'))

CONTENT = 'Thornswood-Content.esp'
OWN = 'thornswood-content.esp'
OURS_AFTER = ['Thornswood-Last.esp']
MASTERS = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']
DELETED, DISABLED = 0x20, 0x800

SAMPLE = 16.0
STOREY = 60.0
LAYER = 250.0
MARGIN = 30.0
TURN_COST = 60.0
# The turns tried at each spot, from the anchor's own angle.
TURNS = (0, 45, 90, 135, 180, 225, 270, 315)
CLEAR_BELOW, CLEAR_ABOVE = 6.0, 140.0
DRY = 8.0
# A small plant, which a kiln may stand among: a TREE or FLOR record no larger
# than this on a side (thickets, shrubs, ferns, flowers), never a crop plot.
PLANT = 250.0
# The largest rock or cliff a salt vein is set into, on a side.
INTO_ROCK = 4000.0
# A salt vein's ground may fall this far under the miner's floor before the
# vein would float: its bounds reach 16 units below its origin.
VEIN_DEPTH = 16.0
KILN_FROM_BENCH = 1000.0
# A notice board the server stands, its drop box and room to read them (#2516):
# a square this far each way from the board's point.
BOARD_ROOM = 250.0
# Where somebody stands at a woodworking bench and its table, in its frame.
BENCH_OUTLINE = (-75.0, -55.0, 85.0, 88.0)

# THE FOUR KINDS. base: the station record in Thornswood-Content.esp. user:
# where somebody stands to work it, in its own frame (x right, y the way they
# face). Every one of the three furniture meshes has one furniture marker, at
# its origin and facing +y, read out of Furniture\\SmelterMarker.nif and
# Furniture\\AlchemyWorkbench.nif in Skyrim - Meshes0.bsa on 16 October: the
# kiln's user stands inside its bounds and walks in from behind. The quarry
# and the hive are worked from in front of them. flat: how far the ground may
# fall across the outline; the kiln's bounds reach 34 units below its origin,
# so its far side may sink that far. reach: how far from the anchor the
# search goes. step: how far apart the spots it tries are.
KINDS = {
    'kiln': {'base': 0x1547E, 'edid': 'ThornswoodCraftingCharcoalKilnMarker', 'name': 'charcoal kiln',
             'user': (-35.0, -230.0, 35.0, 8.0), 'flat': 48.0, 'reach': 1600, 'step': 48, 'sample': 32.0, 'plants': True},
    'salt': {'base': 0xDDE4EF, 'edid': 'ThornswoodFurnitureSaltMine', 'name': 'salt quarry',
             'user': (-35.0, -300.0, 35.0, -236.0), 'flat': 32.0, 'reach': 1600, 'step': 48, 'sample': 32.0, 'shore': 120.0, 'embedded': True},
    'hive': {'base': 0xDBF8B3, 'edid': 'ThornswoodFloraBeehive', 'name': 'beehive',
             'user': (-35.0, -180.0, 35.0, -115.0), 'flat': 40.0, 'reach': 1200, 'step': 32},
    'lab': {'base': 0x42E69, 'edid': 'ThornswoodCraftingAlchemyWorkbench', 'name': 'alchemy lab',
            'user': (-35.0, -55.0, 35.0, 8.0), 'flat': 8.0, 'reach': 900, 'step': 16},
    # The well bucket (#1382) is an activator somebody walks up to and
    # presses: they stand in front of it, inside the game's reach of it.
    'well': {'base': 0x18030, 'edid': 'ThornswoodActivatorWellBucket', 'name': 'well bucket',
             'user': (-30.0, -80.0, 30.0, -18.0), 'flat': 8.0, 'reach': 400, 'step': 16},
    # The water bucket (#1382) stands on a river's or a lake's bank: its ground
    # no lower than the water and no more than two storeys above it.
    'river': {'base': 0x18031, 'edid': 'ThornswoodActivatorWaterBucket', 'name': 'water bucket',
              'user': (-30.0, -80.0, 30.0, -18.0), 'flat': 8.0, 'reach': 3000, 'step': 48, 'shore': 60.0,
              'river': True},
    # The study desk (#1387) is an activator wearing Skyrim's NobleDesk01,
    # whose origin is at its back edge (its bounds run from y -49 to 12), the
    # edge Skyrim stands against a wall: somebody stands at its open front,
    # inside the game's reach of it, to press it.
    'study': {'base': 0x18032, 'edid': 'ThornswoodActivatorStudyDesk', 'name': 'study desk',
              'user': (-35.0, -110.0, 35.0, -50.0), 'flat': 8.0, 'reach': 900, 'step': 16},
}

RULES = {
    'kiln': ('One for each of the nine towns with a woodworking bench, outside the town: beside the chopping '
             'block in the open world nearest that town\'s forge, among those 1,000 units or more from every bench '
             '(#2337), within 12,000 units of the forge, or 20,000 for Solitude and Markarth, whose nearest blocks '
             'are at Katla\'s Farm and Salvius Farm. It may stand among small plants, the way Skyrim\'s smelters do '
             '(Patrick, B on #2553). The kiln turns the firewood split at a chopping block into the charcoal every '
             'forge burns (charburner.md, smith.md).'),
    'salt': ('One on the shore of each hold capital on the Sea of Ghosts (Solitude, Windhelm, Dawnstar, '
             'Winterhold), beside the boat drawn up nearest the town: its forge, or Winterhold\'s smithing anvil. '
             'The quarry is an ore vein, so it is set into rock the way Skyrim\'s veins are: only the place the '
             'miner stands needs clear, dry, flat ground, and the vein lies on ground no lower than its underside '
             'or inside a rock or cliff (Patrick, B on #2553). Salt comes from the sea (miner.md, the salt quarry).'),
    'hive': ('One at each of Skyrim\'s own named farms that has at least 5 crop plots of the farmer\'s table '
             'within 2,400 units, the farm claim\'s circle, of the farm\'s point: its map marker, or the '
             'farmhouse\'s outside door where that marker is inside the house. It stands beside the crop plot '
             'nearest that point. A placed hive is a farmer verb (farmer.md).'),
    'well': ('One beside each of the placed wells in game/data/wells.json (#1382): the wells are statics and '
             'raise no activation, so the bucket is what somebody activates to draw water there (Patrick, 12 '
             'October 2026, approved on #1382). A well in a cell no master of the content plugin carries is left '
             'out, because the plugin can only place into its masters\' cells.'),
    'river': ('One on the river nearest each of the nine towns with a forge (#1382), the nearest clear spot to '
              'the forge within 3,000 units whose cell\'s water is river water by game/data/waters.json, and one '
              'on Lake Honrich at Riften, whose water the records call deep. At the edge: ground no lower than '
              'that water and no more than 120 units above it, and navmesh under the water within 160 units, so '
              'the water is there to reach. Patrick, 12 October 2026, approved '
              'drawing spots at rivers and lakes on #1382, and 20 October 2026: lake water is worth what river '
              'water is, so one bucket serves both, and both must be boiled.'),
    'study': ('One in each of the four halls of the College of Winterhold, the Hall of the Elements, the Hall of '
              'Countenance, the Hall of Attainment and the Arcanaeum, beside the tables, or in the Hall of the '
              'Elements the benches, that the site names in that hall: a semester at the College is taken at a '
              'study desk in the College halls, not a command (Patrick, 22 October 2026, A on #1387; magic.md).'),
    'lab': ('One in the apothecary of each of the nine hold capitals, the shop Skyrim marks as a store that holds '
            'Skyrim\'s own alchemy lab, beside that lab; Winterhold has no apothecary in town, so the College\'s '
            'Hall of Countenance. The poultice and the remedy are made only at Thornswood\'s lab (physicker.md, '
            'injury.md).'),
}

# THE SITES. kind, where, anchor (the reference the spot is measured from),
# the space it stands in (a worldspace, or the interior cell), ref: the
# placement's form id in Thornswood-Content.esp, which never changes once
# given. point: what the rule measures the anchor against (a kiln's town
# forge, a quarry's town forge or anvil, a hive's farm point).
SITES = {
    # Kilns: the chopping block nearest the town's forge, 1,000 units or more from its bench.
    'kiln-whiterun': {'kind': 'kiln', 'where': 'Whiterun', 'point': 'c430a:Skyrim.esm', 'ref': 0x15500},
    'kiln-solitude': {'kind': 'kiln', 'where': 'Solitude', 'point': '4e3e9:Skyrim.esm', 'ref': 0x15501,
                      'townReach': 20000.0},
    'kiln-windhelm': {'kind': 'kiln', 'where': 'Windhelm', 'point': 'f7798:Skyrim.esm', 'ref': 0x15502},
    'kiln-markarth': {'kind': 'kiln', 'where': 'Markarth', 'point': '514d8:Skyrim.esm', 'ref': 0x15503,
                      'townReach': 20000.0},
    'kiln-riften': {'kind': 'kiln', 'where': 'Riften', 'point': '53481:Skyrim.esm', 'ref': 0x15504},
    'kiln-falkreath': {'kind': 'kiln', 'where': 'Falkreath', 'point': '99b8a:Skyrim.esm', 'ref': 0x15505},
    'kiln-dawnstar': {'kind': 'kiln', 'where': 'Dawnstar', 'point': 'cadf6:Skyrim.esm', 'ref': 0x15506},
    'kiln-morthal': {'kind': 'kiln', 'where': 'Morthal', 'point': '24588:JKs Skyrim.esp', 'ref': 0x15507},
    'kiln-riverwood': {'kind': 'kiln', 'where': 'Riverwood', 'point': 'd6987:Skyrim.esm', 'ref': 0x15508},
    # Salt quarries: the boat nearest the town on the Sea of Ghosts.
    'salt-solitude': {'kind': 'salt', 'where': 'Solitude', 'point': '4e3e9:Skyrim.esm', 'ref': 0x15510},
    'salt-windhelm': {'kind': 'salt', 'where': 'Windhelm', 'point': 'f7798:Skyrim.esm', 'ref': 0x15511},
    'salt-dawnstar': {'kind': 'salt', 'where': 'Dawnstar', 'point': 'cadf6:Skyrim.esm', 'ref': 0x15512},
    'salt-winterhold': {'kind': 'salt', 'where': 'Winterhold', 'point': '89c2:JKs Skyrim.esp', 'ref': 0x15513},
    # Hives: the crop plot nearest each named farm's point.
    'hive-battleborn': {'kind': 'hive', 'where': 'Battle-Born Farm', 'farm': '18c8d:Skyrim.esm',
                        'point': '16332:Skyrim.esm', 'ref': 0x15520},
    'hive-brandymug': {'kind': 'hive', 'where': 'Brandy-Mug Farm', 'farm': '18c8f:Skyrim.esm',
                       'point': '16339:Skyrim.esm', 'ref': 0x15521},
    'hive-chillfurrow': {'kind': 'hive', 'where': 'Chillfurrow Farm', 'farm': '18c90:Skyrim.esm',
                         'point': '1633c:Skyrim.esm', 'ref': 0x15522},
    'hive-dragonbridge': {'kind': 'hive', 'where': 'Dragon Bridge Farm', 'farm': '20006:Skyrim.esm',
                          'point': '1775b:Skyrim.esm', 'ref': 0x15523},
    'hive-corpselight': {'kind': 'hive', 'where': 'Corpselight Farm, Falkreath', 'farm': '200bd:Skyrim.esm',
                         'point': '1776a:Skyrim.esm', 'ref': 0x15524},
    'hive-hlaalu': {'kind': 'hive', 'where': 'Hlaalu Farm', 'farm': '18e35:Skyrim.esm',
                    'point': '16355:Skyrim.esm', 'ref': 0x15525},
    'hive-hollyfrost': {'kind': 'hive', 'where': 'Hollyfrost Farm', 'farm': '18e36:Skyrim.esm',
                        'point': '16358:Skyrim.esm', 'ref': 0x15526},
    'hive-katla': {'kind': 'hive', 'where': 'Katla\'s Farm', 'farm': '18e38:Skyrim.esm',
                   'point': '1635e:Skyrim.esm', 'ref': 0x15527},
    'hive-loreius': {'kind': 'hive', 'where': 'Loreius Farm', 'farm': '18e3b:Skyrim.esm',
                     'point': '284c7:Skyrim.esm', 'ref': 0x15528},
    'hive-merryfair': {'kind': 'hive', 'where': 'Merryfair Farm', 'farm': '18e3c:Skyrim.esm',
                       'point': '268fe:Skyrim.esm', 'ref': 0x15529},
    'hive-pelagia': {'kind': 'hive', 'where': 'Pelagia Farm', 'farm': '18e3f:Skyrim.esm',
                     'point': '16373:Skyrim.esm', 'ref': 0x1552A},
    'hive-cowflop': {'kind': 'hive', 'where': 'Cowflop Farm, Rorikstead', 'farm': '1f882:Skyrim.esm',
                     'point': '177cf:Skyrim.esm', 'ref': 0x1552B},
    'hive-lemkil': {'kind': 'hive', 'where': 'Lemkil\'s Farm, Rorikstead', 'farm': '1f884:Skyrim.esm',
                    'point': '177cd:Skyrim.esm', 'ref': 0x1552C},
    'hive-salvius': {'kind': 'hive', 'where': 'Salvius Farm', 'farm': '18e40:Skyrim.esm',
                     'point': '20521:Skyrim.esm', 'ref': 0x1552D},
    'hive-sarethi': {'kind': 'hive', 'where': 'Sarethi Farm', 'farm': '18e41:Skyrim.esm',
                     'point': '16377:Skyrim.esm', 'ref': 0x1552E},
    'hive-snowshod': {'kind': 'hive', 'where': 'Snow-Shod Farm', 'farm': '18e43:Skyrim.esm',
                      'point': '1634a:Skyrim.esm', 'ref': 0x1552F},
    # Labs: beside Skyrim's own lab in each capital's apothecary.
    'lab-whiterun': {'kind': 'lab', 'where': 'Arcadia\'s Cauldron, Whiterun', 'anchors': ['c6e45:Skyrim.esm'],
                     'ref': 0x15540},
    'lab-solitude': {'kind': 'lab', 'where': 'Angeline\'s Aromatics, Solitude', 'anchors': ['c6ce9:Skyrim.esm'],
                     'ref': 0x15541},
    'lab-windhelm': {'kind': 'lab', 'where': 'The White Phial, Windhelm', 'anchors': ['c6dff:Skyrim.esm', '10e3b6:Skyrim.esm'],
                     'ref': 0x15542},
    'lab-riften': {'kind': 'lab', 'where': 'Elgrim\'s Elixirs, Riften', 'anchors': ['16dc1:Skyrim.esm'],
                   'ref': 0x15543},
    'lab-markarth': {'kind': 'lab', 'where': 'The Hag\'s Cure, Markarth', 'anchors': ['c76e5:Skyrim.esm'],
                     'ref': 0x15544},
    'lab-falkreath': {'kind': 'lab', 'where': 'Grave Concoctions, Falkreath', 'anchors': ['c6cea:Skyrim.esm'],
                      'ref': 0x15545},
    'lab-dawnstar': {'kind': 'lab', 'where': 'The Mortar and Pestle, Dawnstar', 'anchors': ['c76e1:Skyrim.esm'],
                     'ref': 0x15546},
    'lab-morthal': {'kind': 'lab', 'where': 'Thaumaturgist\'s Hut, Morthal', 'anchors': ['c6c3b:Skyrim.esm'],
                    'ref': 0x15547},
    'lab-winterhold': {'kind': 'lab', 'where': 'The College\'s Hall of Countenance, Winterhold',
                       'anchors': ['86775:Skyrim.esm'], 'ref': 0x15548},
    # Study desks (#1387): in each hall of the College, beside its own tables, or the
    # Hall of the Elements' benches, which is all the furniture it has to read at.
    'study-arcanaeum': {'kind': 'study', 'where': 'the Arcanaeum, the College of Winterhold',
                        'hall': '13810:Skyrim.esm',
                        'anchors': ['77da3:Skyrim.esm', '77f9c:Skyrim.esm', '78014:Skyrim.esm'], 'ref': 0x18150},
    'study-attainment': {'kind': 'study', 'where': 'the Hall of Attainment, the College of Winterhold',
                         'hall': 'cab91:Skyrim.esm',
                         'anchors': ['83316:Skyrim.esm', '83317:Skyrim.esm', '8334c:Skyrim.esm', '8319d:Skyrim.esm'],
                         'ref': 0x18151},
    'study-countenance': {'kind': 'study', 'where': 'the Hall of Countenance, the College of Winterhold',
                          'hall': '1380f:Skyrim.esm',
                          'anchors': ['8661e:Skyrim.esm', '86708:Skyrim.esm', '866a5:Skyrim.esm'], 'ref': 0x18152},
    'study-elements': {'kind': 'study', 'where': 'the Hall of the Elements, the College of Winterhold',
                       'hall': '1380e:Skyrim.esm',
                       'anchors': ['10cea6:Skyrim.esm', '10cea9:Skyrim.esm', '10ceaa:Skyrim.esm'], 'ref': 0x18153},
    # Water buckets (#1382): on the river shore nearest each town's forge, and on
    # Lake Honrich at Riften. lake: a town Skyrim's own map sets on a lake, whose
    # deep water is that lake. Every other deep water is the sea or a marsh's.
    'river-dawnstar': {'kind': 'river', 'where': 'the river at Dawnstar', 'point': 'cadf6:Skyrim.esm', 'ref': 0x18140},
    'river-falkreath': {'kind': 'river', 'where': 'the river at Falkreath', 'point': '99b8a:Skyrim.esm', 'ref': 0x18141},
    'river-markarth': {'kind': 'river', 'where': 'the river at Markarth', 'point': '514d8:Skyrim.esm', 'ref': 0x18142},
    'river-morthal': {'kind': 'river', 'where': 'the river at Morthal', 'point': '24588:JKs Skyrim.esp', 'ref': 0x18143},
    'river-riften': {'kind': 'river', 'where': 'Lake Honrich at Riften', 'lake': True, 'point': '53481:Skyrim.esm', 'ref': 0x18144},
    'river-riverwood': {'kind': 'river', 'where': 'the river at Riverwood', 'point': 'd6987:Skyrim.esm', 'ref': 0x18145},
    'river-solitude': {'kind': 'river', 'where': 'the river at Solitude', 'point': '4e3e9:Skyrim.esm', 'ref': 0x18146},
    'river-whiterun': {'kind': 'river', 'where': 'the river at Whiterun', 'point': 'c430a:Skyrim.esm', 'ref': 0x18147},
    'river-windhelm': {'kind': 'river', 'where': 'the river at Windhelm', 'point': 'f7798:Skyrim.esm', 'ref': 0x18148},
    # Well buckets (#1382): beside each placed well of game/data/wells.json, by its cell.
    'well-01': {'kind': 'well', 'where': 'DLC2SkaalVilFarmWell01 in 142ec:Dragonborn.esm', 'anchors': ['2b245:Dragonborn.esm'], 'ref': 0x18100},
    'well-02': {'kind': 'well', 'where': 'FarmWell01 in 965b:Skyrim.esm', 'anchors': ['1f99b:ElysiumEstate.esp'], 'ref': 0x18101},
    'well-03': {'kind': 'well', 'where': 'ImpWell01 in 9722:Skyrim.esm', 'anchors': ['10aaa6:Skyrim.esm'], 'ref': 0x18102},
    'well-04': {'kind': 'well', 'where': 'FarmWell01 in 9ad9:Skyrim.esm', 'anchors': ['2b2c:aaaGraniteHill.esp'], 'ref': 0x18103},
    'well-05': {'kind': 'well', 'where': 'ImpWell01 in BloatedMansRuins', 'anchors': ['95342:Skyrim.esm'], 'ref': 0x18104},
    'well-06': {'kind': 'well', 'where': 'FarmWell01 in DLC1RedwaterDen01', 'anchors': ['8c34:Dawnguard.esm'], 'ref': 0x18105},
    'well-07': {'kind': 'well', 'where': 'FarmBWellEnt01 in DLC2HrodulfsHouse', 'anchors': ['21093:Dragonborn.esm'], 'ref': 0x18106},
    'well-08': {'kind': 'well', 'where': 'RedoranWell01 in DLC2RavenRock02', 'anchors': ['1caff:Dragonborn.esm'], 'ref': 0x18107},
    'well-09': {'kind': 'well', 'where': 'GenericWell01 in DushnikhYalExterior02', 'anchors': ['5a646:Skyrim.esm'], 'ref': 0x18108},
    'well-10': {'kind': 'well', 'where': 'FarmBWellEnt01 in FalkreathBarracksJail', 'anchors': ['ef416:Skyrim.esm'], 'ref': 0x18109},
    'well-11': {'kind': 'well', 'where': 'FarmBWell01 in FalkreathBarracksJail', 'anchors': ['ef43d:Skyrim.esm'], 'ref': 0x1810A},
    'well-12': {'kind': 'well', 'where': 'FarmWell01 in FalkreathExterior02', 'anchors': ['ef327:Skyrim.esm'], 'ref': 0x1810B},
    'well-13': {'kind': 'well', 'where': 'ImpWell01 in FellglowKeepExterior02', 'anchors': ['71a9a:Skyrim.esm'], 'ref': 0x1810C},
    'well-14': {'kind': 'well', 'where': 'ImpExtIceWell01 in FortDunstadExterior02', 'anchors': ['2088b:Skyrim.esm'], 'ref': 0x1810D},
    'well-15': {'kind': 'well', 'where': 'ImpWell01 in FortGreenwall04', 'anchors': ['5c535:Skyrim.esm'], 'ref': 0x1810E},
    'well-16': {'kind': 'well', 'where': 'ImpWell01 in FortGreymoorExterior03', 'anchors': ['51762:Skyrim.esm'], 'ref': 0x1810F},
    'well-17': {'kind': 'well', 'where': 'ImpExtIceWell01 in FortNeugradExterior04', 'anchors': ['33ed9:Skyrim.esm'], 'ref': 0x18110},
    'well-18': {'kind': 'well', 'where': 'ImpWell01 in FortSnowhawkExterior04', 'anchors': ['6f3de:Skyrim.esm'], 'ref': 0x18111},
    'well-19': {'kind': 'well', 'where': 'ImpWell01 in FortSungardCourtyard', 'anchors': ['352a9:Skyrim.esm'], 'ref': 0x18112},
    'well-20': {'kind': 'well', 'where': 'ImpWell01 in FortSungardExterior01', 'anchors': ['798a0:Skyrim.esm'], 'ref': 0x18113},
    'well-21': {'kind': 'well', 'where': 'ImpExtIceWell01 in FrostflowLighthouseExterior01', 'anchors': ['cd4cc:Skyrim.esm'], 'ref': 0x18114},
    'well-22': {'kind': 'well', 'where': 'ImpWell01 in POIPineForest08', 'anchors': ['2107b:North Keep.esp'], 'ref': 0x18115},
    'well-23': {'kind': 'well', 'where': 'FarmWell01 in POITundra08', 'anchors': ['5448:OarsRest.esp'], 'ref': 0x18116},
    'well-24': {'kind': 'well', 'where': 'FarmWell01 in POITundra08', 'anchors': ['5449:OarsRest.esp'], 'ref': 0x18117},
    'well-25': {'kind': 'well', 'where': 'RTPlazaWell01 in RiftenOrigin', 'anchors': ['f0ebc:Skyrim.esm'], 'ref': 0x18118},
    'well-26': {'kind': 'well', 'where': 'GenericWell01 in SSewersSolitude02', 'anchors': ['27172:SkyrimSewers.esp'], 'ref': 0x18119},
    'well-27': {'kind': 'well', 'where': 'FarmBWell01 in SSewersWRBurrow', 'anchors': ['3907d:SkyrimSewers.esp'], 'ref': 0x1811A},
    'well-28': {'kind': 'well', 'where': 'ImpWell01 in TrevasWatchExterior01', 'anchors': ['69f82:Skyrim.esm'], 'ref': 0x1811B},
    'well-29': {'kind': 'well', 'where': 'FarmBWell01 in WindhelmMarketplaceExterior', 'anchors': ['9283:JKs Skyrim.esp'], 'ref': 0x1811C},
    'well-30': {'kind': 'well', 'where': 'RTPlazaWell01 in bcd0:Skyrim.esm', 'anchors': ['10060d:Skyrim.esm'], 'ref': 0x1811D},
}

# What a study desk's anchor is: the halls' own reading tables and benches
# (measured on #1387 by scripts\\dev\\List-CellRefs.py over the four cells).
STUDY_ANCHOR = re.compile(r'^Noble(Table(Square|Round|Thin)01|Bench01)$')

# Farms the rule leaves out, measured over the same load order.
LEFT_OUT = {
    'FalkreathLodsHouseLocation': 'Lod\'s house in Falkreath, which Skyrim marks as a farm, has 3 crop plots within '
                                  '2,400 units of its door: a smith\'s yard, not a field.',
}


def key_of(desc):
    obj, owner = desc.split(':', 1)
    return (owner.lower(), int(obj, 16))


# ------------------------------------------------------------------ reading --

class Scan(object):
    """One pass over every plugin for what the sites need: the anchors and
    the points, every placed thing and navmesh round them, and which plugins
    carry each cell and worldspace record."""

    def __init__(self, plugins, world, keys, regions, interiors, pool_bases):
        self.refs, self.navms, self.carriers, self.cellinfo = {}, {}, {}, {}
        self.pool = {}
        for pi, pl in enumerate(plugins):
            def visit(tag, p, size, flags, fid, w, c, pl=pl, pi=pi):
                if tag in (b'CELL', b'WRLD'):
                    k = pl.key(fid)
                    self.carriers.setdefault((tag, k), []).append(pi)
                    ss = wb.subs(pl.body(p, size, flags))
                    info = self.cellinfo.setdefault((tag, k), {})
                    info['edid'] = next((b.rstrip(b'\0').decode('latin1') for t, b in ss if t == b'EDID'),
                                        info.get('edid', ''))
                    for t, b in ss:
                        if tag == b'CELL' and t == b'XCLW' and len(b) >= 4:
                            info['water'] = struct.unpack_from('<f', b)[0]
                        elif tag == b'WRLD' and t == b'DNAM' and len(b) >= 8:
                            info['water'] = struct.unpack_from('<2f', b)[1]
                    return
                if tag == b'NAVM':
                    if not c:
                        return
                    ci = world.cells.get(c)
                    if not ci:
                        return
                    if ci[2]:
                        if c not in interiors:
                            return
                        space = ('cell', c)
                    else:
                        if not ci[1] or (ci[0], ci[1][0], ci[1][1]) not in regions:
                            return
                        space = ('world', ci[0])
                    k = pl.key(fid)
                    if flags & DELETED:
                        self.navms[k] = None
                        return
                    for t, b in wb.subs(pl.body(p, size, flags)):
                        if t == b'NVNM':
                            nv = struct.unpack_from('<I', b, 16)[0]
                            verts = struct.unpack_from('<%df' % (nv * 3), b, 20)
                            q = 20 + nv * 12
                            nt = struct.unpack_from('<I', b, q)[0]
                            tris = [struct.unpack_from('<3H', b, q + 4 + i * 16) for i in range(nt)]
                            self.navms[k] = (space, verts, tris)
                    return
                if tag != b'REFR':
                    return
                k = pl.key(fid)
                ci = world.cells.get(c) if c else None
                interior = bool(ci and ci[2])
                wk = None if interior else (w or (ci[0] if ci else None))
                d = pl.body(p, size, flags)
                base, pos, scale, xesp = None, None, 1.0, None
                for t, b in wb.subs(d):
                    if t == b'NAME':
                        base = pl.key(struct.unpack_from('<I', b)[0])
                    elif t == b'DATA' and len(b) >= 24:
                        pos = struct.unpack_from('<6f', b)
                    elif t == b'XSCL':
                        scale = struct.unpack_from('<f', b)[0]
                    elif t == b'XESP':
                        xesp = pl.key(struct.unpack_from('<I', b)[0])
                if pos is None:
                    return
                if interior:
                    space = ('cell', c)
                    wanted = k in keys or c in interiors
                else:
                    space = ('world', wk)
                    wanted = k in keys or (wk, int(pos[0] // 4096), int(pos[1] // 4096)) in regions
                pooled = base in pool_bases and not interior
                if not wanted and not pooled:
                    return
                prev = self.refs.get(k) or self.pool.get(k)
                row = dict(base=base, pos=list(pos[:3]), rot=list(pos[3:]), scale=scale, flags=flags,
                           xesp=xesp, space=space, cell=c, by=pl.name, pi=pi,
                           touched=(prev['touched'] if prev else []) + [pl.name])
                if pooled:
                    self.pool[k] = row
                if wanted:
                    self.refs[k] = row
            pl.walk(visit, tops={b'WRLD', b'CELL'})


CROPS = set()
BOAT = re.compile(r'(Row|Long)Boat', re.I)
BLOCK = ('WoodChoppingBlock', 'DLC2WoodChoppingBlock')
# The worldspaces whose coordinates are Tamriel's: Tamriel and its five walled cities.
TAMRIEL = ('skyrim.esm', 0x3C)
SHARED = {('skyrim.esm', x) for x in (0x3C, 0x1A26F, 0x37EDF, 0x1691D, 0x16D71, 0x16BB4)}


# ---------------------------------------------------------------- geometry --

class Ground(object):
    """The navmesh of one worldspace or cell round a site, bucketed so a
    sample looks at a handful of triangles."""
    CELL = 128.0

    def __init__(self, navms, space, cx, cy, radius):
        self.buckets = {}
        for k, v in navms.items():
            if not v or v[0] != space:
                continue
            _, vs, ts = v
            for t in ts:
                P = [(vs[i * 3], vs[i * 3 + 1], vs[i * 3 + 2]) for i in t]
                x0, x1 = min(p[0] for p in P), max(p[0] for p in P)
                y0, y1 = min(p[1] for p in P), max(p[1] for p in P)
                if x1 < cx - radius or x0 > cx + radius or y1 < cy - radius or y0 > cy + radius:
                    continue
                tri = (P, x0, x1, y0, y1)
                for bx in range(int(math.floor(x0 / self.CELL)), int(math.floor(x1 / self.CELL)) + 1):
                    for by in range(int(math.floor(y0 / self.CELL)), int(math.floor(y1 / self.CELL)) + 1):
                        self.buckets.setdefault((bx, by), []).append(tri)

    def at(self, x, y, zref):
        best = None
        for P, x0, x1, y0, y1 in self.buckets.get((int(math.floor(x / self.CELL)), int(math.floor(y / self.CELL))), ()):
            if x < x0 or x > x1 or y < y0 or y > y1:
                continue
            a, b, c = P
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-9:
                continue
            l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d
            l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d
            l3 = 1 - l1 - l2
            if min(l1, l2, l3) < -1e-6:
                continue
            z = l1 * a[2] + l2 * b[2] + l3 * c[2]
            if abs(z - zref) < LAYER and (best is None or abs(z - zref) < abs(best - zref)):
                best = z
        return best


def box_of(outline):
    xs = [p[0] for p in outline]
    ys = [p[1] for p in outline]
    return (min(xs), min(ys), max(xs), max(ys))


def thing(ref, edid, outline, lo, hi, solid, plant=False, rock=False, into=False):
    """Something near a site. plant: a small plant (a TREE or FLOR under
    PLANT units a side that is not a crop plot). rock: one of Skyrim's rocks
    or cliffs (a static whose mesh is under Landscape). into: a rock too large
    to be an obstacle, kept only so a salt vein can be set into it."""
    return dict(ref=ref, edid=edid, outline=outline, box=box_of(outline), lo=lo, hi=hi, solid=solid,
                plant=plant, rock=rock, into=into)


def things_round(world, refs, space, cx, cy, radius, skip):
    """Everything solid near a site, as the bench builder counts it."""
    out = []
    for k, r in refs.items():
        if r['space'] != space or (r['flags'] & (DELETED | DISABLED)) or k in skip:
            continue
        if math.hypot(r['pos'][0] - cx, r['pos'][1] - cy) > radius:
            continue
        b = world.bases.get(r['base'])
        if not b or b[0] not in wb.SOLID or b[1] in wb.NOT_SOLID or not b[2]:
            continue
        if b[0] != 'FURN' and (not b[5] or b[5].lower().startswith('markers' + chr(92))):
            continue
        ob = b[2]
        area = (ob[3] - ob[0]) * (ob[4] - ob[1]) * r['scale'] ** 2
        if area == 0:
            continue
        side = max(ob[3] - ob[0], ob[4] - ob[1]) * r['scale']
        rock = b[0] in ('STAT', 'SCOL', 'MSTT') and (b[5] or '').lower().startswith('landscape' + chr(92))
        if (b[0] in wb.LARGE and area > wb.BIG_STATIC) or side > wb.VOLUME:
            # The navmesh's to answer for, but a rock or a cliff still holds a
            # salt vein set into it.
            if rock and side <= INTO_ROCK:
                cs = wb.corners(r, ob)
                zs = [c[2] for c in cs]
                out.append(thing(world.desc(k), b[1], wb.hull([(c[0], c[1]) for c in cs]), min(zs), max(zs),
                                 False, rock=True, into=True))
            continue
        cs = wb.corners(r, ob)
        zs = [c[2] for c in cs]
        name = world.desc(k)
        plant = b[0] in ('TREE', 'FLOR') and r['base'] not in CROPS and side <= PLANT
        out.append(thing(name, b[1], wb.hull([(c[0], c[1]) for c in cs]), min(zs), max(zs), True,
                         plant=plant, rock=rock))
        if b[0] == 'FURN':
            out.append(thing(name, b[1] + ', where its user stands',
                             wb.rect(r['pos'][0], r['pos'][1], r['rot'][2], wb.FURN_USER),
                             r['pos'][2] - 20, r['pos'][2] + 150, False))
        elif b[0] == 'DOOR':
            out.append(thing(name, b[1] + ', its way through',
                             wb.rect(r['pos'][0], r['pos'][1], r['rot'][2], wb.DOOR_WAY),
                             r['pos'][2] - 20, r['pos'][2] + 150, False))
    return out


def overlaps(a, b):
    A, B = a, b['box']
    if A[2] <= B[0] or B[2] <= A[0] or A[3] <= B[1] or B[3] <= A[1]:
        return False
    return True


class Spot(object):
    BUCKET = 256.0

    def __init__(self, kind, ground, things, anchor_z, water):
        self.k = kind
        self.ground = ground
        self.things = things
        self.zref = anchor_z
        self.water = water
        self.storey = kind.get('shore') or STOREY
        # Each thing under every square of the floor its bounds cover, so a
        # spot looks at what is near it and not at the whole town.
        self.buckets = {}
        for i, t in enumerate(things):
            x0, y0, x1, y1 = t['box']
            for bx in range(int(math.floor(x0 / self.BUCKET)), int(math.floor(x1 / self.BUCKET)) + 1):
                for by in range(int(math.floor(y0 / self.BUCKET)), int(math.floor(y1 / self.BUCKET)) + 1):
                    self.buckets.setdefault((bx, by), []).append(i)

    def near(self, boxes):
        seen = set()
        for x0, y0, x1, y1 in boxes:
            for bx in range(int(math.floor(x0 / self.BUCKET)), int(math.floor(x1 / self.BUCKET)) + 1):
                for by in range(int(math.floor(y0 / self.BUCKET)), int(math.floor(y1 / self.BUCKET)) + 1):
                    seen.update(self.buckets.get((bx, by), ()))
        return [self.things[i] for i in sorted(seen)]

    def boxes(self, ob):
        return [(ob[0], ob[1], ob[3], ob[4]), self.k['user']]

    def ignores(self, t, part):
        """Whether part (0 the station, 1 where its user stands) may overlap t.
        A kiln stands among small plants (Patrick, B on #2553). A salt vein is
        set into rock, as Skyrim's veins are, and may run through plants; the
        miner's standing place takes nothing."""
        if t['into']:
            return True
        if self.k.get('plants') and t['plant']:
            return True
        if self.k.get('embedded') and part == 0 and (t['rock'] or t['plant']):
            return True
        return False

    def touching(self, close, mine, boxes, zlo, zhi):
        for t in close:
            if t['into'] or t['hi'] < zlo or t['lo'] > zhi:
                continue
            for part, (m, mb) in enumerate(zip(mine, boxes)):
                if not self.ignores(t, part) and overlaps(mb, t) and wb.overlap(m, t['outline']):
                    return 'touches %s (%s)' % (t['edid'], t['ref'])
        return None

    def inside_rock(self, close, px, py, z):
        for t in close:
            if not t['rock'] or t['hi'] < z or t['lo'] > z + CLEAR_ABOVE:
                continue
            x0, y0, x1, y1 = t['box']
            if px < x0 or px > x1 or py < y0 or py > y1:
                continue
            if wb.overlap([(px - 1, py - 1), (px + 1, py - 1), (px + 1, py + 1), (px - 1, py + 1)], t['outline']):
                return True
        return False

    def check(self, x, y, a, ob):
        mine = [wb.rect(x, y, a, bx) for bx in self.boxes(ob)]
        boxes = [box_of(m) for m in mine]
        close = self.near(boxes)
        # A thing high and low enough to be in the way at any floor the spot
        # may have is looked at before the ground, which costs far more. The
        # same test runs again below at the floor the spot has.
        hit = self.touching(close, mine, boxes, self.zref + self.storey + CLEAR_BELOW,
                            self.zref - self.storey + CLEAR_ABOVE)
        if hit:
            return None, hit
        lo = hi = None
        flat = self.k['flat']
        storey = self.storey
        step = self.k.get('sample', SAMPLE)
        embedded = self.k.get('embedded')
        # A vein's ground is only the miner's standing place; the vein itself
        # is looked at after, against that floor.
        sampled = [self.k['user']] if embedded else self.boxes(ob)
        for x0, y0, x1, y1 in sampled:
            for lx, ly in grid(x0, y0, x1, y1, step):
                dx, dy = wb.turn_xy(lx, ly, a)
                z = self.ground.at(x + dx, y + dy, self.zref)
                if z is None:
                    return None, 'off the navmesh'
                if self.water is not None and z < self.water + DRY:
                    return None, 'in the water'
                lo = z if lo is None else min(lo, z)
                hi = z if hi is None else max(hi, z)
                if hi - lo > flat:
                    return None, 'the ground runs %.0f to %.0f' % (lo, hi)
                if lo < self.zref - storey or hi > self.zref + storey + flat:
                    return None, 'its ground is more than %d from the anchor\'s height' % storey
        z = lo
        if abs(z - self.zref) > storey:
            return None, 'its ground is %.0f from the anchor\'s height' % (z - self.zref)
        if embedded:
            # Every part of the vein lies on ground no lower than its own
            # underside and above the water, or inside a rock or cliff.
            x0, y0, x1, y1 = ob[0], ob[1], ob[3], ob[4]
            for lx, ly in grid(x0, y0, x1, y1, step):
                dx, dy = wb.turn_xy(lx, ly, a)
                px, py = x + dx, y + dy
                g = self.ground.at(px, py, z)
                if g is None or abs(g - z) > self.storey:
                    if not self.inside_rock(close, px, py, z):
                        return None, 'the vein hangs over nothing'
                    continue
                if g < z - VEIN_DEPTH:
                    return None, 'the vein hangs over a drop'
                if self.water is not None and g < self.water + DRY:
                    return None, 'the vein lies in the water'
        hit = self.touching(close, mine, boxes, z + CLEAR_BELOW, z + CLEAR_ABOVE)
        if hit:
            return None, hit
        return (z, lo, hi), 'clear'

    def nearest(self, x, y, a, z, ob):
        best = (1e9, None)
        x0, y0, x1, y1 = ob[0], ob[1], ob[3], ob[4]
        c, s = math.cos(a), math.sin(a)
        for t in self.things:
            if not t['solid'] or self.ignores(t, 0) or t['hi'] < z + CLEAR_BELOW or t['lo'] > z + CLEAR_ABOVE:
                continue
            for p in t['outline']:
                dx, dy = p[0] - x, p[1] - y
                lx, ly = dx * c - dy * s, dx * s + dy * c
                ex = max(x0 - lx, 0, lx - x1)
                ey = max(y0 - ly, 0, ly - y1)
                d = math.hypot(ex, ey)
                if d < best[0]:
                    best = (d, t)
        return best


def grid(x0, y0, x1, y1, step):
    nx, ny = max(2, int((x1 - x0) / step) + 1), max(2, int((y1 - y0) / step) + 1)
    for i in range(nx):
        for j in range(ny):
            yield x0 + (x1 - x0) * i / (nx - 1), y0 + (y1 - y0) * j / (ny - 1)


# ------------------------------------------------------------ the cell gate --

class CellGate(object):
    """Whether a copy of Bethesda's own CELL or WRLD record in the content
    plugin changes anything in the game."""

    def __init__(self, order, data, scan, plugins):
        self.order, self.data, self.scan, self.plugins = order, data, scan, plugins
        self.ci = [n for _, n in order].index(CONTENT)
        self.readers, self.tables, self.memo = {}, {}, {}

    def reader(self, pi):
        if pi not in self.readers:
            path, name = self.order[pi]
            src = last.Plugin(path, name, pi)
            self.readers[pi] = (src, {(e.tag, src.gid(e.fid)): e for e in src.walk({b'CELL', b'WRLD'})})
        return self.readers[pi]

    def strings(self, src, kind):
        if (src.name, kind) not in self.tables:
            self.tables[(src.name, kind)] = last.string_table(self.data, src.name, kind)
        return self.tables[(src.name, kind)]

    def canon(self, pi, tag, k):
        src, entries = self.reader(pi)
        e = entries.get((tag, k))
        rn = last.Renumber()
        rn.masters = [m.lower() for m in MASTERS]
        try:
            return sorted(last.copy_record(src, e, rn, self.strings, '%s %s' % (src.name, tag.decode())))
        except (ValueError, SystemExit):
            return None

    def judge(self, tag, k):
        """(ok, words)."""
        if (tag, k) in self.memo:
            return self.memo[(tag, k)]
        names = [n for _, n in self.order]
        carriers = [pi for pi in self.scan.carriers.get((tag, k), []) if names[pi] != CONTENT]
        if k[0] not in [m.lower() for m in MASTERS]:
            out = (False, 'a record of %s, which is not a master of the content plugin' % k[0])
        elif not carriers:
            out = (False, 'in no plugin')
        else:
            later = [names[pi] for pi in carriers if pi > self.ci]
            if later:
                out = (True, 'carried after the content plugin by %s, so the copy never wins' % later[-1])
            else:
                masters = [pi for pi in carriers if names[pi] in MASTERS]
                win = carriers[-1]
                if names[win] in MASTERS:
                    out = (True, 'won by %s, Bethesda\'s own' % names[win])
                else:
                    mine = self.canon(masters[-1], tag, k)
                    theirs = self.canon(win, tag, k)
                    if mine is not None and mine == theirs:
                        out = (True, 'won by %s, the same as %s field for field' % (names[win], names[masters[-1]]))
                    else:
                        out = (False, '%s changes it before the content plugin' % names[win])
        self.memo[(tag, k)] = out
        return out


# ------------------------------------------------------------------- main ----

def boards_from(gm_text):
    """The notice boards the server stands (#2516): {town: (space key, x, y)}."""
    out = {}
    block = gm_text[gm_text.find('var BOARD_SITES = {'):]
    block = block[:block.find('};')]
    for m in re.finditer(r"(\w+):\s*\{ cell: '([0-9a-f]+):([^']+)', pos: \[([^\]]+)\]", block):
        x, y = [float(v) for v in m.group(4).split(',')[:2]]
        out[m.group(1)] = ((m.group(3).lower(), int(m.group(2), 16)), x, y)
    return out


def norm_deg(a):
    return round(((a % 360) + 360) % 360, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.environ.get('THORNSWOOD_DATA') or r'C:\Thornswood\Game\Data')
    ap.add_argument('--out', default=os.path.join(ROOT, 'game', 'data', 'station-sites.json'))
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    lo_doc = json.load(io.open(os.path.join(ROOT, 'game', 'data', 'last-plugin.json'), encoding='utf-8'))
    lo = lo_doc['loadOrder']
    order = [(own_plugins.plugin_path(args.data, n), n) for n in lo]
    missing = [n for p, n in order if not os.path.isfile(p)]
    if missing:
        print('STOP. %d plugin(s) of the load order are not there: %s' % (len(missing), ', '.join(missing[:6])))
        return 1
    plugins = [wb.Plugin(p, n) for p, n in order]
    stop = wb.collection_stop(plugins, [CONTENT], args.data)
    if stop:
        print(stop)
        return 2
    # Thornswood's two plugins after the content plugin place nothing new, so
    # they are not read: measured here, not assumed. Thornswood-Last.esp's
    # placed references are of two kinds, and neither is a station or moves:
    # the town gates Bethesda ships locked (#2484), each a master's own
    # reference left where it stands without its lock or script, which
    # last-plugin.json names; and since #3077 the floor items it switches off,
    # each a master's or a mod's own reference left where it stands, initially
    # disabled, as many as last-plugin.json's floorItems.off, and since #3150
    # the hold-only plants and ores it switches off outside their hold the
    # same way, the ones its holdOnly.off lists. A switched-off item still
    # counts here as something in the way, as it did before, so no spot
    # changes. Anything else it placed would stop this.
    gates = set(lo_doc.get('gatesUnlocked') or [])
    floor_off = int((lo_doc.get('floorItems') or {}).get('off') or 0) + len((lo_doc.get('holdOnly') or {}).get('off') or [])
    for n in OURS_AFTER:
        # Made in the Data folder from its recipe since #2791 (own_plugins.py).
        pl = wb.Plugin(own_plugins.plugin_path(args.data, n), n)
        placed = []
        pl.walk(lambda tag, p, size, flags, fid, w, c: placed.append((fid, flags)) if tag == b'REFR' else None,
                tops={b'WRLD', b'CELL'})
        named, off = [], 0
        for fid, flags in placed:
            i = fid >> 24
            desc = '%x:%s' % (fid & 0xFFFFFF, pl.masters[i]) if i < len(pl.masters) else None
            if n == 'Thornswood-Last.esp' and desc in gates:
                continue
            if n == 'Thornswood-Last.esp' and desc and flags & DISABLED and not flags & DELETED:
                off += 1
                continue
            named.append(desc or '%08X (its own)' % fid)
        if named:
            print('STOP. %s places %d reference(s) that are neither the town gates it unlocks nor floor items it '
                  'switches off (%s); this table would have to read it.' % (n, len(named), ', '.join(named[:6])))
            return 1
        if n == 'Thornswood-Last.esp' and off != floor_off:
            print('STOP. %s switches off %d floor item(s) or hold-only plant(s) and ore(s), and last-plugin.json '
                  'says %d; rebuild it first.'
                  % (n, off, floor_off))
            return 1
    print('The load order: %d plugins, game\\data\\last-plugin.json\'s; %s read from game\\content for its '
          'station records only' % (len(plugins), CONTENT))
    world = wb.World(plugins)

    bases = {}
    for kind, k in KINDS.items():
        b = world.bases.get((OWN, k['base']))
        if not b or b[1] != k['edid'] or b[4] != CONTENT or not b[2]:
            print('STOP. %x:%s is not %s in %s' % (k['base'], CONTENT, k['edid'], CONTENT))
            return 1
        bases[kind] = b
    station_bases = {(OWN, k['base']) for k in KINDS.values()}

    harvests = json.load(io.open(os.path.join(ROOT, 'game', 'data', 'harvests.json'), encoding='utf-8'))
    CROPS.update(key_of(c) for c in harvests['crops'])
    benches = json.load(io.open(os.path.join(ROOT, 'game', 'data', 'woodworking-benches.json'),
                                encoding='utf-8'))['benches']
    boards = boards_from(io.open(os.path.join(ROOT, 'game', 'gamemode.js'), encoding='utf-8').read())

    # Every chopping block, boat and crop plot out of doors, which the rules
    # choose anchors among, and the explicit anchors and points.
    pool_bases = set(CROPS)
    for k, b in world.bases.items():
        if (b[0] == 'FURN' and b[1].startswith(BLOCK)) or BOAT.search(b[1]):
            pool_bases.add(k)
    keys = set()
    for s in SITES.values():
        for f in ('point',):
            if s.get(f):
                keys.add(key_of(s[f]))
        for a in s.get('anchors', ()):
            keys.add(key_of(a))
    first = Scan(plugins, world, keys, set(), set(), pool_bases)
    fails = []
    skipped = {}
    candidates = {}
    for site, s in sorted(SITES.items()):
        got = anchors_for(site, s, world, first, benches)
        if isinstance(got, str) and got.startswith('left out: '):
            got = got[len('left out: '):]
            skipped[site] = {'kind': s['kind'], 'where': s['where'], 'triedAnchors': [], 'why': got}
            print('  %-18s LEFT OUT. %s' % (site, got))
            continue
        if isinstance(got, str) and got.startswith('no ') and ' stands in the open world within ' in got:
            # The rule gives this town no anchor at all: left out, and why.
            skipped[site] = {'kind': s['kind'], 'where': s['where'], 'triedAnchors': [], 'why': got}
            print('  %-18s LEFT OUT. %s' % (site, got))
            continue
        if isinstance(got, str):
            fails.append('%s: %s' % (site, got))
            print('  %-18s STOP. %s' % (site, got))
            continue
        candidates[site] = got
    regions, interiors = set(), set()
    for site, cands in candidates.items():
        for k, r in cands:
            if r['space'][0] == 'world':
                gx, gy = int(r['pos'][0] // 4096), int(r['pos'][1] // 4096)
                for x in range(gx - 1, gx + 2):
                    for y in range(gy - 1, gy + 2):
                        regions.add((r['space'][1], x, y))
            else:
                interiors.add(r['space'][1])
    for site in candidates:
        for k, r in candidates[site]:
            keys.add(k)
    scan = Scan(plugins, world, keys, regions, interiors, set())
    gate = CellGate(order, args.data, scan, plugins)
    skip = {k for k, x in scan.refs.items() if k[0] == OWN and x['base'] in station_bases}

    rows = {}
    taken = {}   # space -> the stations already chosen
    buckets = []   # (space, x, y, site) of each well bucket already chosen
    for site in sorted(candidates):
        s = SITES[site]
        kind = KINDS[s['kind']]
        say = '  %-18s ' % site
        passed = []
        found = None
        if s['kind'] == 'well':
            # Two wells side by side are one place to draw water: the second
            # shares the first one's bucket rather than standing another beside it.
            r = candidates[site][0][1]
            near = [(math.hypot(r['pos'][0] - x, r['pos'][1] - y), other) for sp, x, y, other in buckets
                    if sp == r['space']]
            near = [n for n in near if n[0] < WELL_SHARED]
            if near:
                d, other = min(near)
                why = 'it shares the bucket of %s, %d units away' % (other, round(d))
                skipped[site] = {'kind': s['kind'], 'where': s['where'], 'triedAnchors': [], 'why': why}
                print(say + 'LEFT OUT. ' + why)
                continue
        for k, r in candidates[site]:
            r = scan.refs.get(k, r)
            got = search(s, kind, r, world, scan, gate, benches, boards, taken, bases[s['kind']][2], skip)
            if isinstance(got, str):
                passed.append({'anchor': world.desc(k), 'why': got})
                continue
            found = (k, r, got)
            break
        if not found:
            # Left out, and why, measured: the same as a town the benches skip
            # (#516). Nothing is placed where the measure refuses every spot.
            skipped[site] = {'kind': s['kind'], 'where': s['where'], 'triedAnchors': passed}
            print(say + 'LEFT OUT. no anchor of its rule has a clear spot beside it')
            for p in passed:
                print('      %s: %s' % (p['anchor'], p['why']))
            continue
        k, r, (x, y, z, a, glo, ghi, dist, near, dx, dy, t, ck, words, outline) = found
        b = world.bases.get(r['base'])
        space = r['space']
        taken.setdefault(space, []).append(
            thing('the %s at %s' % (kind['name'], s['where']), 'another station (#2553)', outline, z - 40, z + 300, True))
        if s['kind'] == 'well':
            buckets.append((space, x, y, site))
        cinfo = scan.cellinfo.get((b'CELL', ck), {})
        row = {
            'kind': s['kind'],
            'where': s['where'],
            'ref': '%x:%s' % (s['ref'], CONTENT),
            'base': '%x:%s' % (KINDS[s['kind']]['base'], CONTENT),
            'anchor': world.desc(k),
            'anchorEdid': b[1] if b else '',
            'anchorRecordFrom': r['by'],
            'anchorTouchedBy': r['touched'],
            'anchorAt': [round(v, 1) for v in r['pos']],
            'anchorAngle': norm_deg(math.degrees(r['rot'][2])),
            'passedOver': passed,
            'space': world.desc(space[1]),
            'spaceEdid': (world.worlds.get(space[1], '') if space[0] == 'world'
                          else scan.cellinfo.get((b'CELL', space[1]), {}).get('edid', '')),
            'interior': space[0] == 'cell',
            'cell': world.desc(ck),
            'cellEdid': cinfo.get('edid', ''),
            'cellCopy': words,
            'offset': [dx, dy],
            'turn': t,
            'pos': [round(x, 1), round(y, 1), round(z, 1)],
            'angle': norm_deg(math.degrees(a)),
            'groundUnder': [round(glo, 1), round(ghi, 1)],
            'fromAnchor': round(math.hypot(dx, dy)),
            'nearest': {'edid': near['edid'], 'ref': near['ref'], 'units': round(dist)} if near else None,
        }
        for f in ('point', 'farm', 'plotsWithin2400', 'townReach'):
            if s.get(f) is not None:
                row[f] = s[f]
        if space[0] == 'world':
            row['worldCopy'] = gate.judge(b'WRLD', space[1])[1]
        rows[site] = row
        print(say + '%-26s %-16s at %s turned %s, %d from its anchor, ground %.0f to %.0f, nearest %s %d%s'
              % ((b[1] if b else '?')[:26], row['cellEdid'][:16] or row['cell'], row['pos'], row['angle'],
                 row['fromAnchor'], glo, ghi, near['edid'] if near else 'nothing', dist if near else 0,
                 (', %d anchor(s) passed over' % len(passed)) if passed else ''))

    if fails:
        print('')
        for f in fails:
            print('  ' + f)
        print('%d site(s) failed; nothing was written.' % len(fails))
        return 1

    counts = {}
    for v in rows.values():
        counts[v['kind']] = counts.get(v['kind'], 0) + 1
    payload = {
        'builtBy': 'scripts/dev/Build-StationSites.py',
        'issue': 2553,
        'decided': ('Patrick, 16 October 2026, A on #2553: Thornswood measures its own spots for the kilns, salt '
                    'quarries, beehives and alchemy labs, the way the woodworking benches were placed, and the '
                    'content plugin places them.'),
        'readFrom': ('game/data/last-plugin.json loadOrder, the collection\'s bytes; from %s only its four station '
                     'records; %s place nothing' % (CONTENT, ' and '.join(OURS_AFTER))),
        'kinds': {kind: {'base': '%x:%s' % (k['base'], CONTENT), 'edid': k['edid'], 'name': k['name'],
                         'bounds': list(bases[kind][2]), 'user': list(k['user']), 'flat': k['flat'],
                         'reach': k['reach'], 'rule': RULES[kind], 'count': counts.get(kind, 0),
                         'amongPlants': bool(k.get('plants')), 'setIntoRock': bool(k.get('embedded'))}
                  for kind, k in KINDS.items()},
        'measure': ('Each station stands at the nearest clear spot to its anchor, tried every step units out to its '
                    'reach in eight turns of the anchor\'s angle, a turn costing %d units. Its outline and its '
                    'user\'s place lie on the navmesh, on ground flat to the kind\'s flat and within %d units of the '
                    'anchor\'s height, out of doors above the water, and touch no furniture, container, door, item, '
                    'plant or static under %d by %d, nor where anybody stands at other furniture, the way through a '
                    'door, a woodworking bench, a notice board, or another station, from %g to %g units above the '
                    'floor, with %d units to the nearest solid thing. A kiln stands %d units or more from every '
                    'woodworking bench. A kiln may stand among small plants, and a salt vein is set into rock: '
                    'only its miner\'s place needs the ground (Patrick, B on #2553). The cell and worldspace '
                    'records the plugin carries are Bethesda\'s and '
                    'change nothing in the game.'
                    % (TURN_COST, STOREY, int(math.sqrt(wb.BIG_STATIC)), int(math.sqrt(wb.BIG_STATIC)), CLEAR_BELOW,
                       CLEAR_ABOVE, MARGIN, KILN_FROM_BENCH)),
        'leftOut': LEFT_OUT,
        'skipped': skipped,
        'sites': rows,
        'builtAgainst': [{'name': pl.name, 'size': pl.size, 'sha256': pl.sha256}
                         for pl in plugins if pl.name != CONTENT],
    }
    text = json.dumps(payload, indent=1, sort_keys=True) + '\n'
    if args.check:
        old = io.open(args.out, encoding='utf-8').read() if os.path.isfile(args.out) else ''
        print('')
        if old != text:
            print('--check: game/data/station-sites.json differs from what the plugins give now. Run this without '
                  '--check, then scripts/mods/Add-ContentRecords.py.')
            return 1
        print('--check: the table is what the plugins give. Nothing was written.')
        return 0
    io.open(args.out, 'w', encoding='utf-8', newline='\n').write(text)
    print('')
    print('wrote %s, %d station(s): %s' % (args.out, len(rows), ', '.join('%d %s' % (n, k) for k, n in sorted(counts.items()))))
    return 0


GRID = {}


def cell_at(world, wk, x, y):
    """The exterior cell of worldspace wk under x, y: a master's own when a
    mod adds another at the same grid."""
    if not GRID:
        for k, v in sorted(world.cells.items()):
            if v[0] is not None and v[1] is not None and not v[2]:
                GRID.setdefault((v[0], v[1][0], v[1][1]), []).append(k)
    found = GRID.get((wk, int(math.floor(x / 4096)), int(math.floor(y / 4096))))
    if not found:
        return None
    own = [k for k in found if k[0] in [m.lower() for m in MASTERS]]
    return (own or found)[0]


# How many of a rule's anchors are tried, nearest first, before a site stops.
MAX_ANCHORS = 8
# Two of a hive's candidate plots stand at least this far apart, so a second
# try looks at other ground and not the next plot of the same row.
PLOT_APART = 400.0
# How far from its town a kiln's chopping block or a quarry's boat may be and
# still be that town's: three cells. Morthal's lumber mill is 6,706 units from
# its anvil and Winterhold's nearest boat 8,778 below the town; a block further
# off stands by another town or farm (Markarth's nearest is Salvius Farm's,
# 15,707 units out, and Solitude's Katla's Farm's, 18,204).
TOWN_REACH = {'kiln': 12000.0, 'salt': 12000.0}
# What water a cell holds, by game/data/waters.json: the cell's own, else its worldspace's.
WATERS = json.load(io.open(os.path.join(ROOT, 'game', 'data', 'waters.json'), encoding='utf-8'))


# A water bucket stands at the edge: within this far of it the navmesh runs
# under the water, so the water is there to reach.
EDGE = 160.0


def at_the_edge(ground, x, y, water):
    for r in (64.0, 112.0, EDGE):
        for i in range(16):
            t = i * math.pi / 8
            g = ground.at(x + r * math.cos(t), y + r * math.sin(t), water)
            if g is not None and g < water - DRY:
                return True
    return False


def water_class(cell_desc, world_desc):
    w = WATERS['where'].get(cell_desc) or WATERS['where'].get(world_desc)
    return (WATERS['waters'].get(w) or {}).get('c') if w else None


# A well this close to one that already has its bucket shares that bucket.
WELL_SHARED = 300.0
# The well bases, by editor id: game/data/wells.json's.
WELL_BASES = set(json.load(io.open(os.path.join(ROOT, 'game', 'data', 'wells.json'), encoding='utf-8'))['wells'])


def usable(r):
    return not (r['flags'] & (DELETED | DISABLED)) and not r['xesp']


def anchors_for(site, s, world, first, benches):
    """The anchors a site's rule gives, nearest first: [(key, reference)], or
    why there are none."""
    kind = s['kind']
    if kind == 'lab':
        out = []
        for a in s['anchors']:
            r = first.refs.get(key_of(a))
            b = world.bases.get(r['base']) if r else None
            if not r or not usable(r):
                return 'the lab %s is not placed, or is switched off or has an enable parent' % a
            if not b or b[0] != 'FURN' or 'WICraftingAlchemy' not in [world.kywd.get(x, '') for x in b[3]]:
                return '%s is not one of Skyrim\'s alchemy labs' % a
            if r['space'][0] != 'cell':
                return 'the lab %s is not indoors' % a
            out.append((key_of(a), r))
        return out
    if kind == 'study':
        out = []
        for a in s['anchors']:
            r = first.refs.get(key_of(a))
            b = world.bases.get(r['base']) if r else None
            if not r or not usable(r):
                return 'the anchor %s is not placed, or is switched off or has an enable parent' % a
            if not b or not STUDY_ANCHOR.match(b[1]):
                return '%s is not one of the College\'s tables or benches' % a
            if r['space'] != ('cell', key_of(s['hall'])):
                return 'the anchor %s is not in the hall %s' % (a, s['hall'])
            out.append((key_of(a), r))
        return out
    if kind == 'well':
        a = s['anchors'][0]
        r = first.refs.get(key_of(a))
        b = world.bases.get(r['base']) if r else None
        if not r or not usable(r):
            return 'left out: the well %s is not placed, or is switched off or has an enable parent' % a
        if not b or b[1] not in WELL_BASES:
            return '%s is not one of the wells in game/data/wells.json' % a
        if r['cell'] and r['cell'][0] not in [m.lower() for m in MASTERS]:
            return ('left out: the well %s stands in a cell of %s, which is not a master of %s'
                    % (a, r['cell'][0], CONTENT))
        return [(key_of(a), r)]
    pt = first.refs.get(key_of(s['point']))
    if not pt or pt['space'][0] != 'world':
        return 'its point %s is not placed out of doors' % s['point']
    if kind == 'river':
        # The search goes out from the forge itself, to the river bank nearest it.
        return [(key_of(s['point']), pt)]
    px, py = pt['pos'][0], pt['pos'][1]
    rows = []
    if kind == 'kiln':
        if not [v for v in benches.values() if v['forge'] == s['point']]:
            return 'no woodworking bench stands at the forge %s' % s['point']
        for k, x in first.pool.items():
            xb = world.bases.get(x['base'])
            if not xb or xb[0] != 'FURN' or not xb[1].startswith(BLOCK) or not usable(x):
                continue
            if x['space'] != ('world', TAMRIEL):
                continue
            if any(math.hypot(x['pos'][0] - v['pos'][0], x['pos'][1] - v['pos'][1]) < KILN_FROM_BENCH
                   for v in benches.values()):
                continue
            d = math.hypot(x['pos'][0] - px, x['pos'][1] - py)
            if d <= s.get('townReach', TOWN_REACH['kiln']):
                rows.append((d, world.desc(k), k, x))
        rows.sort()
        return [(k, x) for d, n, k, x in rows[:MAX_ANCHORS]] or 'no chopping block stands in the open world within %d units of the forge' % s.get('townReach', TOWN_REACH['kiln'])
    if kind == 'salt':
        for k, x in first.pool.items():
            xb = world.bases.get(x['base'])
            if not xb or not BOAT.search(xb[1]) or not usable(x) or x['space'] != ('world', TAMRIEL):
                continue
            d = math.hypot(x['pos'][0] - px, x['pos'][1] - py)
            if d <= TOWN_REACH['salt']:
                rows.append((d, world.desc(k), k, x))
        rows.sort()
        return [(k, x) for d, n, k, x in rows[:MAX_ANCHORS]] or 'no boat stands in the open world within %d units of the town' % TOWN_REACH['salt']
    if kind == 'hive':
        for k, x in first.pool.items():
            if x['base'] not in CROPS or not usable(x) or x['space'] != pt['space']:
                continue
            d = math.hypot(x['pos'][0] - px, x['pos'][1] - py)
            if d <= 2400:
                rows.append((d, world.desc(k), k, x))
        rows.sort()
        if len(rows) < 5:
            return '%d crop plots within 2,400 units of %s, under 5' % (len(rows), s['point'])
        s['plotsWithin2400'] = len(rows)
        out = []
        for d, n, k, x in rows:
            if all(math.hypot(x['pos'][0] - y['pos'][0], x['pos'][1] - y['pos'][1]) >= PLOT_APART for _, y in out):
                out.append((k, x))
            if len(out) == MAX_ANCHORS:
                break
        return out
    return 'no rule for %s' % kind


def search(s, kind, r, world, scan, gate, benches, boards, taken, ob, skip):
    """The nearest clear spot beside one anchor, or why there is none."""
    space = r['space']
    ax, ay, az = r['pos']
    reach = kind['reach']
    ground = Ground(scan.navms, space, ax, ay, reach + 700)
    stuff = things_round(world, scan.refs, space, ax, ay, reach + 900, skip)
    # The server's benches and boards, and the stations already chosen.
    for town, v in benches.items():
        if space == ('world', key_of(v['cell'])):
            stuff.append(thing('the woodworking bench in ' + v['where'], 'a woodworking bench (#516)',
                               wb.rect(v['pos'][0], v['pos'][1], math.radians(v['angle']), BENCH_OUTLINE),
                               v['pos'][2] - 20, v['pos'][2] + 150, True))
    for town, (sp, bx, by) in boards.items():
        if space == ('world', sp):
            stuff.append(thing('the notice board in ' + town, 'a notice board and its drop box (#2516)',
                               [(bx - BOARD_ROOM, by - BOARD_ROOM), (bx + BOARD_ROOM, by - BOARD_ROOM),
                                (bx + BOARD_ROOM, by + BOARD_ROOM), (bx - BOARD_ROOM, by + BOARD_ROOM)],
                               -1e9, 1e9, True))
    stuff += taken.get(space, [])
    water = None
    if space[0] == 'world':
        water = scan.cellinfo.get((b'WRLD', space[1]), {}).get('water')
    # On the shore the anchor is a boat on the water, so the ground is measured
    # from the sea: dry, and no higher above it than a storey and a half.
    zref = (water + kind['shore']) if kind.get('shore') and water is not None else az
    spot = Spot(kind, ground, stuff, zref, water)
    fa = r['rot'][2]
    tries = []
    step = kind['step']
    for t in TURNS:
        for dx in range(-reach, reach + 1, step):
            for dy in range(-reach, reach + 1, step):
                d = math.hypot(dx, dy)
                if d <= reach:
                    tries.append((d + (0 if t == 0 else TURN_COST), t, dx, dy))
    tries.sort()
    refused = {}

    def say_no(why):
        refused[why] = refused.get(why, 0) + 1
    for score, t, dx, dy in tries:
        ox, oy = wb.turn_xy(dx, dy, fa)
        x, y = ax + ox, ay + oy
        a = fa + math.radians(t)
        # The walled cities share Tamriel's coordinates, so every bench counts.
        if s['kind'] == 'kiln' and any(math.hypot(v['pos'][0] - x, v['pos'][1] - y) < KILN_FROM_BENCH
                                      for v in benches.values()):
            say_no('within 1,000 units of a woodworking bench')
            continue
        if space[0] == 'world':
            ck = cell_at(world, space[1], x, y)
            if ck is None:
                say_no('in no cell')
                continue
            # The cell's own water over the world's.
            cw = scan.cellinfo.get((b'CELL', ck), {}).get('water')
            spot.water = cw if cw is not None and abs(cw) < 1e8 else water
            if kind.get('river'):
                # A water bucket's water is its cell's: a river's, or inland a lake's.
                wc = water_class(world.desc(ck), world.desc(space[1]))
                if wc != 'river' and not (wc == 'deep' and s.get('lake')):
                    say_no('not by river or lake water')
                    continue
                if spot.water is None:
                    say_no('no water in its cell')
                    continue
                spot.zref = spot.water + kind['shore']
        got, w = spot.check(x, y, a, ob)
        if not got:
            say_no(re.sub(r' \(.*\)$|[-0-9]+', '#', w) if not w.startswith('touches') else w.split(' (')[0])
            continue
        z, glo, ghi = got
        if kind.get('river') and not at_the_edge(ground, x, y, spot.water):
            say_no('not at the water\'s edge')
            continue
        dist, near = spot.nearest(x, y, a, z, ob)
        if near and dist < MARGIN:
            say_no('under %d units from %s' % (MARGIN, near['edid']))
            continue
        ck = cell_at(world, space[1], x, y) if space[0] == 'world' else space[1]
        ok, words = gate.judge(b'CELL', ck)
        if not ok:
            say_no('its cell %s: %s' % (world.desc(ck), words))
            continue
        if space[0] == 'world':
            okw, wwords = gate.judge(b'WRLD', space[1])
            if not okw:
                return 'its worldspace %s: %s' % (world.desc(space[1]), wwords)
        outline = wb.hull([p for bx in spot.boxes(ob) for p in wb.rect(x, y, a, bx)])
        return (x, y, z, a, glo, ghi, dist, near, dx, dy, t, ck, words, outline)
    most = sorted(refused.items(), key=lambda x: (-x[1], x[0]))[:4]
    return 'no clear spot within %d units (%s)' % (reach, '; '.join('%d %s' % (n, w) for w, n in most))


if __name__ == '__main__':
    sys.exit(main())
