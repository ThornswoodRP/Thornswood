"""
Build-LastPlugin.py

Builds Thornswood-Last.esp, the small plugin that loads at the very end of the
load order, from the installed plugins and the repository's own tables. Every
byte of it comes out of this script. Nobody edits it in an editor.

WHY (issue #2468)

Patrick, 12 October: "make it so the server and client never load the cut NPCs
not even once ... currently it shows them for a split second the first time you
go in that area and then they disappear", and the dialogue pop-ups "when you go
through the White run gate ... I don't want that there like at all". The same
day: "all vanilla quests can also be cut entirely and never loaded". He
approved a small plugin at the end of the load order on 12 October, for #516
and #1394 as well as this.

WHY THE CUT ONES FLASHED, measured in the fork at its pin (cdd84651):

  The server never made them. game/gamemode.js hands the catalogue's cut list
  to setNpcPlacementExclusions, and WorldState::LoadForm refuses every one of
  those ids before it reads the record.

  Each person's own game did. Skyrim loads every placed actor of a cell from the
  plugins the moment the cell loads. The client's WorldCleanerService
  (skymp5-client/src/services/services/worldCleanerService.ts) then removes
  actors the server does not own, ONE PER FRAME, picked at random among the
  actors within 8,192 units, with disable() and delete(). With a few dozen
  placed actors in a city that is seconds of them standing there. That is the
  flash. The cleaner skips an actor that is disabled already.

  The gate talk came from vanilla quests that run in each person's own game:
  Skyrim starts every quest flagged Start Game Enabled when the game loads, and
  the Story Manager starts the others on its events (arriving at a location,
  actors near each other). SkyMP blocks Papyrus events on the client
  (blockPapyrusEventsService.ts), but dialogue, packages, force greets and
  scenes are the engine's own and run without Papyrus. The Whiterun gate's
  quest, DialogueWhiterunGuardGateStop (d1984:Skyrim.esm), is Start Game
  Enabled; its guard's WhiterunGateGuardForcegreet package (d198b) is the
  pop-up.

WHAT IT PUTS IN THE PLUGIN

  1. Every placed actor the NPC catalogue cuts (game/data/npc-population.json,
     the 1 October rules) is overridden INITIALLY DISABLED, with no enable
     parent, so no machine ever draws it and the server's reader
     (WorldState::AttachEspmRecord) never makes it. The override keeps the
     actor's base, position and editor id and nothing else: no scripts, no
     links, no enable parent, so nothing can switch it back on.
     Left alone: actors a later plugin already deleted, actors that are
     already disabled with no enable parent (they never show), and the
     authored corpses while the policy file says they stay (decision on #2468).

  2. Every vanilla quest (Skyrim.esm, Update.esm, Dawnguard.esm,
     HearthFires.esm, Dragonborn.esm), except the ones the policy file keeps
     (Patrick's decisions on #2468), is overridden so it can never start in anybody's
     game: Start Game Enabled is cleared, and a condition that is never true
     is put first among its Story Manager conditions, as an AND, so no Story
     Manager event can start it. Everything else on the quest is the winning
     record's own. The gate, door and arrival talk is in these quests.

  3. The mod quests the policy names (modQuestsStopped) are stopped the same
     way: the collection's mods' own gate, door and arrival talk (Patrick,
     12 October, decision 8 on #2468). A quest with such talk that the policy
     neither stops nor keeps stops the build, so a new one is decided, not
     missed.

  4. The places on Tamriel's ground that Skyrim and the collection's mods put
     in no hold get one (Patrick, 17 October 2026, decision 2 = B on #2551),
     from the policy's placeHolds. A location record is copied from its
     winner with only its parent (PNAM) changed: to the hold's location, or
     to the place on Patrick's list it lies in (Dead Drop Falls, in
     Dayspring Canyon), so the game, the server, the main menu's last
     location and scripts/dev/Build-BuildingHolds.py all read the place in
     that hold. A room that has no location record at all (Oar's Rest's
     utility room, the Lost Hut, Mossy Glen Cave) cannot have a parent
     changed, so its cell is copied from its winner with only its location
     (XLCN) set: the location of the place it belongs to when there is one,
     the hold's own when none covers it. Everything else on each record is
     the winner's own.

  5. Nothing lies on the floor (Patrick, 21 October 2026, #3077: "don't
     spawn floor items anymore at all no matter what they are"). Every
     placed reference whose base a person could pick up is overridden
     initially disabled, keeping its base and position, the way a cut actor
     is: every weapon, armour piece, arrow, misc item, potion, ingredient,
     book, soul gem, scroll, key and note, every light that can be carried
     (a torch; every other light is the world's lighting), and the six coin
     purses, which are flora. Every other flora (plants, fish, hanging game)
     is a harvestable and stays. A thing a person drops is made at runtime,
     in no plugin, and is never touched. One already initially disabled is
     left only when nothing could switch it on: no enable parent and no
     script. A Thornswood plugin's own floor
     item, and a reference whose enable parent is a floor item, stop the
     build, so each is decided rather than switched off unasked. What the
     servers saved about a floor item before needs no clearing: the server
     attaches a plugin reference's saved state only to a reference its
     reader made (WorldState::LoadChangeForm holds it back,
     WorldState::LoadForm applies it), and the reader never makes an
     initially disabled one. A floor item placed by a plugin the policy
     never copies from (notCopiedFrom: Immersive Armors, #2454) has no
     record below it to switch off, and its own is not copied (Patrick,
     22 Oct 2026, q-613-ia-recipes); one standing in a cell or world such a
     plugin wins would need that plugin's record of the place copied, or
     its edit of it undone. Each of those is listed in the manifest
     (floorItems.heldByServer) and in the HELD_BY_SERVER table this
     writes (game/gamemode-tables, #5191), and the server holds it disabled
     itself, the way it holds the three chopping blocks (#495). A cut actor
     (1) standing in such a place is held off the same way
     (refs.heldByServer).

  6. The forge recipes game/data/recost.json re-costs (Patrick, 21 October
     2026, A on #613, and B on #3115): each is the winning record with only
     its input counts changed to the ones the table gives, and an input the
     table takes to 0 (gold coins) taken out, so the same output, bench and
     conditions. scripts/dev/Build-Recost.py writes the table from
     game/data/recipes.json; a winning record whose inputs are not the ones
     the table measured stops the build, because the counts were worked out
     for those inputs and no others. A recipe of a plugin the policy never
     copies from (notCopiedFrom) is not in the table's recipes but its
     notCopied, and one that reached the recipes stops the build like any
     other record of such a plugin (6).

  7. The script properties the policy sets on a mod quest
     (questScriptProperties), each the winning record with only those values
     added or changed on the script the policy names. Skyrim Unbound's start
     (SkyrimUnboundQuestScript.PrepareForStart, then the inventory module's
     GivePlayerStuff) runs in each person's own game and hands the new
     character a random weapon, equipped, which the server never gave: it
     hangs on the hip, invisible, in no inventory, and can still be drawn and
     swung (#3101; Djinn read the compiled scripts on 16 Oct 2026, #2039).
     SkyrimUnboundInventory's ChoiceRandomWeapons False gives no weapon, and
     its ChoiceSpellsMode 1 gives no spell, which would leave the same kind of
     thing in a hand. Patrick, 21 Oct 2026, on the board review (#3192): the
     fix is here. Skyrim Unbound.esp loads after Thornswood-Content.esp, so
     its own record would win over a change there. A property the script
     does not carry is added, one it carries is changed, one of another type
     stops the build, and so does a script the quest does not have.

  8. The recipes game/data/recipes.json moved to their trade's bench
     (movedFrom on a row, TRADE_BENCHES in scripts/dev/Build-RecipeTable.ps1,
     #3120): each is the winning record with only its bench keyword (BNAM)
     changed to the one the row is made at now, so the forge stops listing a
     Tailor's fur hood and the loom lists it. Patrick, 21 October 2026: "make
     sure if a bench has a recipoe that should be on adifferent bench it should
     get moved". A winning record whose bench is not the one recipes.json says
     its mod put it at stops the build. A re-costed recipe (6) that moves is
     one record carrying both. A recipe of a plugin the policy never copies
     from is not copied: it is listed in the RECIPES_MOVED_IN_GAME table this
     writes (game/gamemode-tables, #5191), and each person's game moves its own copy
     of the record, the way RECIPES_SET_IN_GAME sets the re-costed counts.

  9. Skyrim's own perks gate no recipe (#4826; Patrick, 22 Oct 2026, B: the
     whole vanilla perk system goes, not only the recipe perk conditions).
     Nobody here holds a vanilla perk: no perk menu opens and vanilla
     progression is off (classes.md). So a recipe whose record tests one
     (HasPerk, condition function 448) was hidden by the crafting menu from
     everybody, whatever the server's craft gate allowed: 252 of the 276
     rows hidden from somebody allowed to make them, measured 26 Oct 2026 on
     four halves. Every winning recipe that tests a perk is the winning
     record with only those conditions taken out (and the strings that
     follow one, CIS1 and CIS2), so the server alone decides who makes what
     (the craft gate, and the recipes it hides from each person). A recipe
     of a plugin the policy never copies from is copied only when its row
     says perkRecipesCopied (Immersive Armors: Patrick, 31 Oct 2026, A on
     q-4826-ia-perk-recipes), and then the same way, with only its perk
     tests taken out; its counts and bench stay its own here and are set in
     each person's game as before (6, 8). The copy is made on each machine
     from that machine's own copy of the plugin (#2791), so none of its
     bytes are handed on. One of a plugin whose row does not say it keeps
     its perks and is counted (perks.notCopied). Taking a perk test out
     is counting it as passed, as nobody can hold the perk it asks for, so
     a perk test joined to other conditions by OR makes its whole OR group
     pass and the group comes off with it (Skyrim joins OR before AND: a OR
     b AND c is (a OR b) AND c). Measured 31 Oct 2026 on the box: 1,935
     recipes do this, and the twenty the table named are all tempering
     recipes; with the group off, the server alone decides who may temper
     what, as for everything else. A group with no perk
     test, and the AND between groups, are left exactly as they were. A recipe
     re-costed (6), moved (8) and freed of its perks is one record carrying
     all three.

  10. The hold-only plants and ores (Patrick, 22 Oct 2026, page answer A on
      #3150: each hold has 2 to 3 hold-only plants, ores or animals, which
      grow only in their own hold). The policy's holdOnly names each by its
      produce and its hold; every base of game/data/harvests.json or
      game/data/ores.json that gives that produce is hold-only. Every placed
      reference of one standing anywhere but its hold is overridden initially
      disabled, keeping its base and position, the way a floor item is (5),
      and the ones in their hold stay. The hold is the NPC catalogue's rule
      (scripts/dev/Build-CastTable.py, Cast.place): the location the
      reference carries, then its cell's, then the ground under a world's
      persistent cell, then the nearest ground within six cells that names a
      place, with the policy's place holds (4) read in. A Thornswood
      plugin's own placement outside its hold, and one a quest or trade
      table draws from (SOURCE_TABLES), stop the build. Which ones was
      measured by scripts/dev/Measure-HoldResources.py, and the policy says
      what it found beside each.

  A placed actor's or item's override needs the cell it stands in, and the worldspace
  for an exterior, so those are copied too, EXACTLY as the winning plugin has
  them, form ids moved into this plugin's numbering. A quest and a location
  are copied the same way. The plugin's own masters are every plugin those
  copies name.

WHY NOT IN Thornswood-Content.esp

  A copied cell has to be the record that wins at the copy's place in the load
  order, or it undoes the cell edits of the plugins before it. Measured
  12 October: the 1,212 cells holding the actors this switches off have 47
  different winning plugins. 163 of those cells are won by a mod that loads
  before Thornswood-Content.esp, whose edits a copy there could not carry with
  its five base masters, and 429 by one of the 50 plugins that load after it.
  At the end of the load order every copy is the winner, exactly. So
  everything is here.

  The place holds (4) are here for the same reasons, measured 17 October
  over the catalogue's load order: Castle Volkihar's location is won by
  JK's Castle Volkihar.esp, which loads before the content plugin and is not
  among its five masters, so a copy there would undo that mod's edit of it;
  Oar's Rest's utility room and the Lost Hut are OarsRest.esp's and Solitude
  Arena.esp's, which load after the content plugin and so cannot be its
  masters at all; and a new master renumbers every record the content plugin
  adds. Here the copy is the winner, and any plugin can be a master.

WHY IT IS LIGHT (ESL FLAGGED)

  It adds no record of its own, only overrides, so it takes no full load order
  slot: every full plugin keeps its index, and no world reset follows from
  adding it. The server's load order already carries light plugins (#1715).

WHAT IT READS

  The load order is the NPC catalogue's own (npc-population.json loadOrder),
  read from --data, and every plugin has to be the bytes the catalogue was
  built from (sha256), except Thornswood's own (every file in game/content,
  scripts/dev/own_plugins.py), which are read from the repository's
  game/content, where they are made and shipped from. A load order that moved
  means the catalogue is rebuilt first (scripts/dev/Build-NpcPopulation.py), then this. This
  plugin is never read as an input: it is what the catalogue and the policy
  produce, and the catalogue reads past it too.

  game/data/last-plugin-policy.json is what is kept: the quests a kept
  Thornswood feature may still need, until Patrick decides each one, and
  whether the authored corpses stay. Localised names (a cell's, a quest's) are
  read out of the masters' string tables and written in plain, because this
  plugin is not localised.

WHAT IT WRITES

  game/data/last-plugin.recipe, the recipe each machine makes the plugin
  from out of its own plugins (scripts/mods/last_recipe.py says what it holds
  and why, #2791), held to make these exact bytes back on every build; the
  plugin itself into --out, by default Thornswood-Last.esp in --data, where
  the game and the builders after this one read it, and never into the
  repository (Patrick's A on #2791: Thornswood hands on only the recipe); and
  game/data/last-plugin.json, the
  manifest: the plugin's sha256, the load order it was built against, every
  cut actor it switches off and every one it leaves and why, every quest it
  stops and every quest it keeps, and every place it gives a hold, with the
  parent or location it had before, and the floor items it switches off,
  counted by type and by the plugin that won each, with the cells only they
  needed (#2791 reads those). tests/test-2468-last-plugin.js holds the two
  together on every build, without the game, tests/test-2551-place-holds.js
  the place holds and tests/test-3077-floor-items.js the floor items, each
  reading the plugin's records where a machine has the game to make it from
  (tests/last-plugin-made.js).

HOW IT REACHES PEOPLE

  As its recipe, from this repository, never through the collection (#2486 B)
  and never as the plugin (#2791, Patrick's A of 26 October 2026):

    servers  every deploy that puts it on a game server (Deploy-DevGamemode.ps1
             -LoadOrder, Deploy-Server.ps1, Publish-Server.ps1) makes it on the
             box from the recipe, the server's plugins and the box's string
             tables (scripts/deploy/LastPluginOnBox.ps1, Make-LastPlugin.py),
             into the deploy's stage, held to the manifest's sha256 before the
             swap, and puts it at the end of the server's load order.
    people   every Ship places the recipe in the release's Data as
             Data/Thornswood-Last.recipe (Ensure-ShipRequiredData in
             Ship-Rules.ps1), the pack carries it, the launcher makes the
             plugin from it before Play (launcher/app/LastPlugin.cs), and the
             pack's plugin list enables it last, in the server's order. No
             pack, record or installer carries the plugin ($ShipMadeFromRecipe).
    order    the server has it first, then the Ship (#2308): a release that
             changes it is refused until the channel's server holds the same
             bytes.
    bytes    a release is refused when the plugin was built against other
             bytes than the release's own plugins, or another load order
             (Get-ShipLastPluginProblem): a new collection revision means
             running this again, never shipping a plugin that would undo it.

  The catalogue lists it in the servers' load order and the gamemode no longer
  hands the server a cut list of its own; tests/test-2468-last-plugin.js holds
  that coupling both ways.

Usage:
    python scripts/mods/Build-LastPlugin.py --check
    python scripts/mods/Build-LastPlugin.py
    python scripts/mods/Build-LastPlugin.py --verify
    python scripts/mods/Build-LastPlugin.py --data C:\\Thornswood\\Game\\Data

--check builds it in memory and says whether the committed recipe and manifest
are what it builds (the recipe names the plugin's size and sha256, so it pins
the plugin too). --verify makes the plugin from the committed recipe out of
--data, reads the load order with it at its end and checks, record by record,
that no cut actor and no floor item is left able to show and no cut quest is
left able to start, and lists the gate, door and arrival talk with what stops
each. Exit 1 on any refusal.
"""

import argparse
import collections
import hashlib
import io
import json
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'dev'))
import bsa  # noqa: E402  (the repository's archive reader)
import gamemode_tables  # noqa: E402  (where a table the gamemode reads is written, #5191)
sys.path.insert(0, HERE)
import last_recipe  # noqa: E402  (the recipe each machine builds this plugin from, #2791)
import own_plugins  # noqa: E402  (where each plugin of the load order is read from, #2923)

PLUGIN = 'Thornswood-Last.esp'
CONTENT = 'Thornswood-Content.esp'
VANILLA = ('skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm')
DATA_DIR = 'C:\\Thornswood\\Game\\Data'
CATALOGUE = os.path.join(ROOT, 'game', 'data', 'npc-population.json')
POLICY = os.path.join(ROOT, 'game', 'data', 'last-plugin-policy.json')
MANIFEST = os.path.join(ROOT, 'game', 'data', 'last-plugin.json')
RECOST = os.path.join(ROOT, 'game', 'data', 'recost.json')
RECIPES = os.path.join(ROOT, 'game', 'data', 'recipes.json')
OWN_DIR = os.path.join(ROOT, 'game', 'content')
RECIPE = os.path.join(ROOT, 'game', 'data', 'last-plugin.recipe')

COMPRESSED = 0x00040000
DELETED = 0x20
DISABLED = 0x800
LIGHT = 0x200
START_GAME_ENABLED = 0x0001
FORM_VERSION = 44

# The condition that is never true, the same 32 bytes Thornswood-Content.esp
# already carries on the Hearthfire house parts (#2258): GetItemCount (47) of
# Gold001 (0xF, Skyrim.esm) on the subject, less than 0. Nothing carries less
# than no gold, and a Story Manager event with no subject fails it as well.
NEVER_TRUE = struct.pack('<B3sfHHIIIIi', 4 << 5, b'\x00\x00\x00', 0.0, 47, 0,
                         0x0000000F, 0, 0, 0, -1)

# The order Skyrim writes its top groups in.
# Skyrim's HasPerk condition function (#4826), and the subrecords that
# follow a condition and belong to it: its string parameters.
HAS_PERK = 448
CTDA_TRAILERS = (b'CIS1', b'CIS2')
CTDA_OR = 0x01
GROUP_ORDER = [b'COBJ', b'CELL', b'WRLD', b'QUST', b'LCTN']

# The subrecords of a cell that come before its location (XLCN), in the
# order Skyrim.esm writes a cell; a location set on a cell that had none goes
# straight after the last of these it has.
CELL_BEFORE_XLCN = (b'EDID', b'FULL', b'DATA', b'XCLC', b'XCLL', b'TVDT', b'MHDT', b'LTMP',
                    b'LNAM', b'XCLW', b'XNAM', b'XCLR')
# The subrecords of a location that come before its parent (PNAM), the same
# way, for a location that had no parent at all (Nightingale Hall's).
LCTN_BEFORE_PNAM = (b'EDID', b'ACPR', b'LCPR', b'RCPR', b'ACUN', b'LCUN', b'RCUN', b'ACSR',
                    b'LCSR', b'RCSR', b'ACEC', b'LCEC', b'RCEC', b'ACID', b'LCID', b'ACEP',
                    b'LCEP', b'FULL', b'KSIZ', b'KWDA')


# --------------------------------------------------------------- reading

def subrecords(data):
    """(tag, bytes) pairs. A subrecord longer than 65,535 bytes is preceded by
    an XXXX that carries its real size; the pair comes back whole."""
    out, i, big = [], 0, None
    while i + 6 <= len(data):
        tag = data[i:i + 4]
        size = struct.unpack_from('<H', data, i + 4)[0]
        if tag == b'XXXX':
            big = struct.unpack_from('<I', data, i + 6)[0]
            i += 6 + size
            continue
        if big is not None:
            size, big = big, None
        if i + 6 + size > len(data):
            raise ValueError('a subrecord runs past the end of its record')
        out.append((tag, data[i + 6:i + 6 + size]))
        i += 6 + size
    if i != len(data):
        raise ValueError('a record ends inside a subrecord header')
    return out


def pack_subrecords(pairs):
    out = []
    for t, b in pairs:
        if len(b) > 0xFFFF:
            out.append(b'XXXX' + struct.pack('<HI', 4, len(b)) + t + struct.pack('<H', 0) + b)
        else:
            out.append(t + struct.pack('<H', len(b)) + b)
    return b''.join(out)


class Entry(object):
    __slots__ = ('tag', 'flags', 'fid', 'off', 'size', 'ctx', 'pi')

    def __init__(self, tag, flags, fid, off, size, ctx, pi):
        self.tag, self.flags, self.fid, self.off, self.size, self.ctx, self.pi = (
            tag, flags, fid, off, size, ctx, pi)


class Plugin(object):
    def __init__(self, path, name, index):
        self.path, self.name, self.index = path, name, index
        self.buf = open(path, 'rb').read()
        b = self.buf
        if b[:4] != b'TES4':
            raise SystemExit('STOP. %s does not start with a TES4 header. Nothing was written.' % name)
        hs = struct.unpack_from('<I', b, 4)[0]
        self.hflags = struct.unpack_from('<I', b, 8)[0]
        self.header_end = 24 + hs
        self.masters = [x.rstrip(b'\x00').decode('latin1')
                        for t, x in subrecords(b[24:24 + hs]) if t == b'MAST']
        self.localised = bool(self.hflags & 0x80)
        self.strings = {}

    def owner(self, fid):
        idx = fid >> 24
        return self.masters[idx] if idx < len(self.masters) else self.name

    def gid(self, fid):
        """A form id as (owning plugin, object id), the same in every file."""
        return (self.owner(fid).lower(), fid & 0xFFFFFF)

    def data(self, e):
        raw = self.buf[e.off + 24:e.off + 24 + e.size]
        if e.flags & COMPRESSED:
            out = zlib.decompress(raw[4:])
            if len(out) != struct.unpack_from('<I', raw, 0)[0]:
                raise SystemExit('STOP. %s 0x%08X inflates to the wrong size. Nothing was written.'
                                 % (self.name, e.fid))
            return out
        return raw

    def walk(self, want):
        """Every record whose tag is in want, with where it sits.

        A placed reference's ctx is (world fid or None, cell fid, child group
        type 8 or 9, block group, sub-block group); a CELL's is (world fid or
        None, block group, sub-block group, is a world's persistent cell). A
        group is (type, label bytes). All in this file's own numbering."""
        b, out, stack = self.buf, [], []
        p, n = self.header_end, len(self.buf)
        while p + 24 <= n:
            while stack and p >= stack[-1][0]:
                stack.pop()
            tag = b[p:p + 4]
            size = struct.unpack_from('<I', b, p + 4)[0]
            if tag == b'GRUP':
                stack.append((p + size, struct.unpack_from('<i', b, p + 12)[0], b[p + 8:p + 12]))
                p += 24
                continue
            if tag in want:
                flags, fid = struct.unpack_from('<II', b, p + 8)
                ctx = None
                if tag in (b'ACHR', b'REFR', b'CELL'):
                    world = cell = child = block = sub = None
                    for (_, gt, lb) in stack:
                        if gt == 1:
                            world = struct.unpack('<I', lb)[0]
                        elif gt in (2, 4):
                            block = (gt, lb)
                        elif gt in (3, 5):
                            sub = (gt, lb)
                        elif gt == 6:
                            cell = struct.unpack('<I', lb)[0]
                        elif gt in (8, 9, 10):
                            child = gt
                    if tag == b'CELL':
                        ctx = (world, block, sub, world is not None and block is None)
                    else:
                        ctx = (world, cell, child, block, sub)
                out.append(Entry(tag, flags, fid, p, size, ctx, self.index))
            p += 24 + size
        return out


# (plugin, kind): (the table's file name, its bytes), of every table read.
RAW_TABLES = {}


def string_table(data_dir, plugin, kind):
    """{string id: raw bytes} for one plugin's .STRINGS, .DLSTRINGS or
    .ILSTRINGS, loose files first and then the archives, the order the game
    reads them in. The bytes are kept as the table has them, so a name is
    written back exactly."""
    name = '%s_english.%s' % (os.path.splitext(plugin)[0].lower(), kind)
    data = None
    loose = os.path.join(data_dir, 'Strings', name)
    if os.path.isfile(loose):
        data = open(loose, 'rb').read()
    else:
        for archive in sorted(os.listdir(data_dir)):
            if not archive.lower().endswith('.bsa'):
                continue
            try:
                files = bsa.read(os.path.join(data_dir, archive), 'strings')
            except (ValueError, struct.error, zlib.error, IndexError):
                continue
            if 'strings/' + name in files:
                data = files['strings/' + name]
                break
    if data is None:
        raise SystemExit('STOP. no %s for %s in %s. Nothing was written.' % (kind, plugin, data_dir))
    # The table's own bytes, for the recipe to name by its sha256 (#2791).
    RAW_TABLES[(plugin, kind)] = (name, data)
    count = struct.unpack_from('<I', data, 0)[0]
    base = 8 + count * 8
    out = {}
    for i in range(count):
        sid, off = struct.unpack_from('<II', data, 8 + i * 8)
        p = base + off
        if kind == 'strings':
            e = data.index(b'\x00', p)
            out[sid] = data[p:e]
        else:
            n = struct.unpack_from('<I', data, p)[0]
            out[sid] = data[p + 4:p + 4 + n].rstrip(b'\x00')
    return out


# ----------------------------------------------------------------- VMAD

class _R(object):
    def __init__(self, b):
        self.b, self.p = b, 0

    def take(self, fmt):
        v = struct.unpack_from(fmt, self.b, self.p)
        self.p += struct.calcsize(fmt)
        return v[0] if len(v) == 1 else v

    def raw(self, n):
        v = self.b[self.p:self.p + n]
        self.p += n
        return v

    def wstr(self):
        return self.raw(self.take('<H'))


def _ws(s):
    return struct.pack('<H', len(s)) + s


def _obj(r, fmt):
    if fmt == 1:
        fid, alias, unused = r.take('<IhH')
    else:
        unused, alias, fid = r.take('<HhI')
    return {'fid': fid, 'alias': alias, 'unused': unused}


def _wobj(o, fmt):
    if fmt == 1:
        return struct.pack('<IhH', o['fid'], o['alias'], o['unused'])
    return struct.pack('<HhI', o['unused'], o['alias'], o['fid'])


def _value(r, t, fmt):
    if t == 0:
        return None
    if t == 1:
        return _obj(r, fmt)
    if t == 2:
        return r.wstr()
    if t in (3, 4):
        return r.raw(4)
    if t == 5:
        return r.raw(1)
    if t in (11, 12, 13, 14, 15):
        n = r.take('<I')
        one = {11: lambda: _obj(r, fmt), 12: r.wstr, 13: lambda: r.raw(4),
               14: lambda: r.raw(4), 15: lambda: r.raw(1)}[t]
        return [one() for _ in range(n)]
    raise ValueError('a script property of type %d' % t)


def _wvalue(t, v, fmt):
    if t == 0:
        return b''
    if t == 1:
        return _wobj(v, fmt)
    if t == 2:
        return _ws(v)
    if t in (3, 4, 5):
        return v
    if t == 11:
        return struct.pack('<I', len(v)) + b''.join(_wobj(o, fmt) for o in v)
    if t == 12:
        return struct.pack('<I', len(v)) + b''.join(_ws(s) for s in v)
    return struct.pack('<I', len(v)) + b''.join(v)


def _scripts(r, ver, fmt):
    out = []
    for _ in range(r.take('<H')):
        s = {'name': r.wstr(), 'status': r.take('<B') if ver >= 4 else None, 'props': []}
        for _ in range(r.take('<H')):
            name = r.wstr()
            t = r.take('<B')
            st = r.take('<B') if ver >= 4 else None
            s['props'].append({'name': name, 'type': t, 'status': st, 'value': _value(r, t, fmt)})
        out.append(s)
    return out


def _wscripts(scripts, ver, fmt):
    out = [struct.pack('<H', len(scripts))]
    for s in scripts:
        out.append(_ws(s['name']) + (bytes([s['status']]) if ver >= 4 else b''))
        out.append(struct.pack('<H', len(s['props'])))
        for p in s['props']:
            out.append(_ws(p['name']) + bytes([p['type']]) +
                       (bytes([p['status']]) if ver >= 4 else b'') + _wvalue(p['type'], p['value'], fmt))
    return b''.join(out)


def vmad_parse(b, quest):
    """A VMAD as a tree. A quest's carries its stage fragments and its alias
    scripts after the scripts; those are read too, because alias scripts hold
    form ids."""
    r = _R(b)
    ver, fmt = r.take('<hh')
    tree = {'ver': ver, 'fmt': fmt, 'scripts': _scripts(r, ver, fmt), 'quest': None}
    if quest and r.p < len(b):
        q = {'unk': r.take('<B'), 'frags': []}
        n = r.take('<H')
        q['file'] = r.wstr()
        for _ in range(n):
            q['frags'].append((r.take('<H'), r.take('<H'), r.raw(4), r.take('<B'), r.wstr(), r.wstr()))
        q['aliases'] = []
        for _ in range(r.take('<H')):
            o = _obj(r, fmt)
            aver, afmt = r.take('<hh')
            q['aliases'].append({'obj': o, 'ver': aver, 'fmt': afmt, 'scripts': _scripts(r, aver, afmt)})
        tree['quest'] = q
    tree['rest'] = b[r.p:]
    return tree


def vmad_write(tree):
    ver, fmt = tree['ver'], tree['fmt']
    out = [struct.pack('<hh', ver, fmt), _wscripts(tree['scripts'], ver, fmt)]
    q = tree['quest']
    if q is not None:
        out.append(bytes([q['unk']]) + struct.pack('<H', len(q['frags'])) + _ws(q['file']))
        for (i, u, log, u8, sn, fn) in q['frags']:
            out.append(struct.pack('<HH', i, u) + log + bytes([u8]) + _ws(sn) + _ws(fn))
        out.append(struct.pack('<H', len(q['aliases'])))
        for a in q['aliases']:
            out.append(_wobj(a['obj'], fmt) + struct.pack('<hh', a['ver'], a['fmt']) +
                       _wscripts(a['scripts'], a['ver'], a['fmt']))
    out.append(tree['rest'])
    return b''.join(out)


def vmad_objects(tree):
    def props(scripts):
        for s in scripts:
            for p in s['props']:
                if p['type'] == 1:
                    yield p['value']
                elif p['type'] == 11:
                    for o in p['value']:
                        yield o
    for o in props(tree['scripts']):
        yield o
    if tree['quest']:
        for a in tree['quest']['aliases']:
            yield a['obj']
            for o in props(a['scripts']):
                yield o


# ------------------------------------------------------ the town gates

# The town gates (#2484). Bethesda ships these three placed doors locked (XLOC
# level 255, key only): the Whiterun main gate's outside leaf and Riften's two
# outer leaves. In a single game a quest script opens Whiterun's
# (defaultunlockonload on DialogueWhiterunGuardGateStop, stage 10); under SkyMP
# no Papyrus runs and #2468 stops that quest, so nothing ever would. No later
# plugin in the catalogue's order overrides any of them (read 16 Oct). This
# plugin carries each winning record without its lock and without its script,
# so the gates load unlocked. A claimed gate is still locked by the property
# block's own lock script (#615), which never read the record's lock.
GATES = (('skyrim.esm', 0x01B1F1), ('skyrim.esm', 0x042284), ('skyrim.esm', 0x042286))

# What a gate's copy keeps, and which of those hold a form id in their first
# four bytes. Anything else on the record stops the build.
GATE_DROP = {b'XLOC', b'VMAD'}
GATE_PLAIN = {b'EDID', b'DATA'}
GATE_FID_FIRST = {b'NAME', b'XTEL', b'XNDP', b'XLRT'}


# ------------------------------------------------------ the floor items

# Nothing on the floor (#3077). Patrick, 21 Oct 2026: "don't spawn floor
# items anymore at all no matter what they are". Every placed reference whose
# base is something a person can pick up is switched off here the way a cut
# actor is, so no machine draws it and the server's reader never makes it.
# The types are the ones the engine's espm::utils::IsItem calls items, the
# same list forbiddenReloot carries (scripts/deploy/Deploy-Gamemode.ps1), with
# one narrowing: a light is an item only when it can be carried (a torch).
# Every other light is the world's lighting and stays.
FLOOR_TYPES = (b'WEAP', b'ARMO', b'AMMO', b'MISC', b'ALCH', b'INGR', b'BOOK', b'SLGM', b'SCRL',
               b'LIGH', b'KEYM', b'NOTE')
# A light's DATA: time, radius, colour, then its flags; Can Be Carried is 0x2.
LIGHT_FLAGS_AT = 12
LIGHT_CARRIED = 0x2
# The coin purses are flora, not items, and lie on the floor all the same.
# These six are every FLOR in the load order whose produce is coin
# (game/data/harvests.json 'unranked'; tests/test-3077-floor-items.js holds the
# two together): the three purses and the Thieves Guild's three. Every other
# flora is a harvestable (plants, fish, hanging game) and stays.
COIN_PURSES = (('skyrim.esm', 0x0D790C),   # CoinPurseSmall
               ('skyrim.esm', 0x0D8E7F),   # CoinPurseMedium
               ('skyrim.esm', 0x0D8E80),   # CoinPurseLarge
               ('skyrim.esm', 0x0D8E8A),   # TGCoinPurseLargeNEW
               ('skyrim.esm', 0x0D8E8B),   # TGCoinPurseMediumNEW
               ('skyrim.esm', 0x0D8E8C))   # TGCoinPurseSmallNEW


# ------------------------------------------------- what holds a form id

# Which subrecords of each copied record type hold form ids. Anything a copied
# record carries that is in none of these lists stops the build: a form id in
# a field this does not know would keep its old plugin's numbering, which is
# the one mistake that would be found months later.
FIELDS = {
    b'CELL': {
        'fid': {b'LTMP', b'XLCN', b'XCMO', b'XCAS', b'XCIM', b'XEZN', b'XOWN', b'XCCM',
                b'XILL', b'XCWT'},
        'array': {b'XCLR'},
        'plain': {b'EDID', b'DATA', b'XCLW', b'XCLC', b'XCLL', b'MHDT', b'TVDT', b'XWEM',
                  b'LNAM', b'XNAM', b'XWCN', b'XWCU', b'XWCS', b'XRNK'},
        'strings': {b'FULL'},
        'drop': set(),
    },
    b'WRLD': {
        'fid': {b'WNAM', b'CNAM', b'NAM2', b'NAM3', b'ZNAM', b'XLCN', b'XEZN', b'LTMP', b'INAM'},
        'array': set(),
        'plain': {b'EDID', b'ONAM', b'NAMA', b'DATA', b'NAM0', b'NAM9', b'NAM4', b'DNAM',
                  b'PNAM', b'WCTR', b'MNAM', b'MHDT', b'TNAM', b'UNAM', b'XWEM', b'MODL',
                  b'MODT'},
        'strings': {b'FULL'},
        # The offset table points at byte offsets inside the plugin it came
        # from. In this file it would point at nothing, so it is left out.
        'drop': {b'OFST'},
    },
    b'QUST': {
        'fid': {b'VTCK', b'ALPC', b'ALUA', b'ALFR', b'ALRT', b'ALFC', b'ALCO', b'ALDN', b'ECOR',
                b'ALFL', b'QTGL', b'ALEQ', b'ALSP', b'KNAM', b'SPOR', b'OCOR', b'GWOR', b'NAM0',
                b'QNAM'},
        'array': {b'KWDA'},
        'plain': {b'EDID', b'DNAM', b'ENAM', b'FLTR', b'NEXT', b'INDX', b'QSDT', b'ANAM',
                  b'ALST', b'ALID', b'FNAM', b'ALED', b'ALLS', b'ALFI', b'ALFA', b'ALFE',
                  b'ALFD', b'ALCA', b'ALCL', b'ALNA', b'ALNT', b'ALEA', b'KSIZ', b'COCT',
                  b'CIS1', b'CIS2', b'QOBJ', b'QSTA', b'SCHR', b'SCTX', b'SCDA'},
        'strings': {b'FULL', b'NNAM'},
        'dlstrings': {b'CNAM'},
        'drop': set(),
    },
    # A recipe (#613). Its inputs (CNTO) are moved by copy_record itself; an
    # extra data entry on an input (COED) names an owner and stops the build.
    b'COBJ': {
        'fid': {b'CNAM', b'BNAM'},
        'array': set(),
        'plain': {b'EDID', b'COCT', b'NAM1', b'CITC', b'CIS1', b'CIS2'},
        'strings': set(),
        'drop': set(),
    },
    # A location's lists of the references, actors and cells in it. Each
    # 'structs' entry is a run of fixed size structures with form ids at the
    # given offsets (and grid numbers, which stay, in the rest); each 'head'
    # entry starts with a worldspace's form id and is grid numbers after it.
    # Added (AC), master (LC) and removed (RC) lists alike.
    b'LCTN': {
        'fid': {b'PNAM', b'NAM1', b'FNAM', b'MNAM', b'NAM0'},
        'array': {b'KWDA', b'RCPR', b'RCUN', b'RCSR', b'ACID', b'LCID'},
        'structs': {b'ACPR': (12, (0, 4)), b'LCPR': (12, (0, 4)),
                    b'ACUN': (12, (0, 4, 8)), b'LCUN': (12, (0, 4, 8)),
                    b'ACSR': (16, (0, 4, 8)), b'LCSR': (16, (0, 4, 8)),
                    b'ACEP': (12, (0, 4)), b'LCEP': (12, (0, 4))},
        'head': {b'ACEC', b'LCEC', b'RCEC'},
        'plain': {b'EDID', b'KSIZ', b'RNAM', b'CNAM'},
        'strings': {b'FULL'},
        'drop': set(),
    },
}


class Renumber(object):
    """Moves form ids from a source plugin's numbering into this plugin's.

    Built in two passes: the first only notes which plugins are named (so the
    master list is known), the second rewrites."""

    def __init__(self):
        self.masters = None
        self.named = set()

    def one(self, src, fid, what):
        if fid == 0:
            return 0
        idx = fid >> 24
        if idx > len(src.masters):
            raise SystemExit('STOP. %s names 0x%08X in %s, outside its masters. Nothing was written.'
                             % (src.name, fid, what))
        owner = src.owner(fid).lower()
        if self.masters is None:
            self.named.add(owner)
            return fid
        return (self.masters.index(owner) << 24) | (fid & 0xFFFFFF)

    def gid(self, g):
        """A record named by (owning plugin, object id) rather than through a
        source plugin's masters: a bench keyword a recipe is moved to."""
        if self.masters is None:
            self.named.add(g[0])
            return g[1]
        return (self.masters.index(g[0]) << 24) | g[1]

    def ctda(self, src, b, what):
        b = bytearray(b)
        # Use-global: the comparison value is a GLOBAL's form id.
        if b[0] & 0x04:
            struct.pack_into('<I', b, 4, self.one(src, struct.unpack_from('<I', b, 4)[0], what))
        # The two parameters hold a form id or a plain number depending on the
        # function. A number is moved only if its top byte names a master of
        # the source; for every source this plugin copies from today the first
        # masters keep their index, so a small number is never changed.
        for off in (12, 16):
            v = struct.unpack_from('<I', b, off)[0]
            if v and (v >> 24) <= len(src.masters):
                struct.pack_into('<I', b, off, self.one(src, v, what))
        # The reference the condition runs on.
        v = struct.unpack_from('<I', b, 24)[0]
        if v:
            struct.pack_into('<I', b, 24, self.one(src, v, what))
        return bytes(b)

    def vmad(self, src, b, quest, what):
        tree = vmad_parse(b, quest)
        if vmad_write(tree) != b:
            raise SystemExit('STOP. the scripts on %s do not read back as their own bytes. '
                             'Nothing was written.' % what)
        for o in vmad_objects(tree):
            o['fid'] = self.one(src, o['fid'], what)
        return vmad_write(tree)


def copy_record(src, entry, rn, strings, what):
    """The record's subrecords with every form id in this plugin's numbering
    and every localised string written out in plain."""
    table = FIELDS[entry.tag]
    out = []
    for t, b in subrecords(src.data(entry)):
        if t in table['drop']:
            continue
        if t in table['fid']:
            if len(b) != 4:
                raise SystemExit('STOP. %s %s is %d bytes, not a form id. Nothing was written.'
                                 % (what, t.decode(), len(b)))
            b = struct.pack('<I', rn.one(src, struct.unpack('<I', b)[0], what))
        elif t in table['array']:
            if len(b) % 4:
                raise SystemExit('STOP. %s %s is %d bytes, not a list of form ids. Nothing was written.'
                                 % (what, t.decode(), len(b)))
            b = b''.join(struct.pack('<I', rn.one(src, v, what))
                         for v in struct.unpack('<%dI' % (len(b) // 4), b))
        elif t in table.get('structs', {}):
            size, offsets = table['structs'][t]
            if len(b) % size:
                raise SystemExit('STOP. %s %s is %d bytes, not a list of %d byte entries. Nothing was written.'
                                 % (what, t.decode(), len(b), size))
            b = bytearray(b)
            for at in range(0, len(b), size):
                for o in offsets:
                    struct.pack_into('<I', b, at + o, rn.one(src, struct.unpack_from('<I', b, at + o)[0], what))
            b = bytes(b)
        elif t in table.get('head', ()):
            if len(b) < 4 or (len(b) - 4) % 4:
                raise SystemExit('STOP. %s %s is %d bytes, not a worldspace and its cells. Nothing was written.'
                                 % (what, t.decode(), len(b)))
            b = struct.pack('<I', rn.one(src, struct.unpack_from('<I', b, 0)[0], what)) + b[4:]
        elif t == b'RNAM' and entry.tag == b'WRLD':
            b = bytearray(b)
            count = struct.unpack_from('<I', b, 4)[0]
            if len(b) != 8 + 8 * count:
                raise SystemExit('STOP. %s RNAM does not hold %d references. Nothing was written.'
                                 % (what, count))
            for i in range(count):
                o = 8 + 8 * i
                struct.pack_into('<I', b, o, rn.one(src, struct.unpack_from('<I', b, o)[0], what))
            b = bytes(b)
        elif t == b'CTDA':
            b = rn.ctda(src, b, what)
        elif t == b'CNTO':
            b = struct.pack('<I', rn.one(src, struct.unpack_from('<I', b, 0)[0], what)) + b[4:]
        elif t == b'VMAD':
            b = rn.vmad(src, b, entry.tag == b'QUST', what)
        elif t in table['strings'] or t in table.get('dlstrings', ()):
            if src.localised:
                kind = 'dlstrings' if t in table.get('dlstrings', ()) else 'strings'
                sid = struct.unpack('<I', b)[0]
                text = strings(src, kind).get(sid) if sid else b''
                if text is None:
                    raise SystemExit('STOP. %s %s names string %d, which %s does not have. '
                                     'Nothing was written.' % (what, t.decode(), sid, src.name))
                b = text + b'\x00'
        elif t not in table['plain']:
            raise SystemExit('STOP. %s carries %s, which this does not know how to copy. '
                             'Nothing was written.' % (what, t.decode()))
        out.append((t, b))
    return out


# ----------------------------------------------------------- the build

def ref_key(desc):
    obj, name = desc.split(':', 1)
    return (name.lower(), int(obj, 16))


def desc_of(gid, canon):
    return '%x:%s' % (gid[1], canon[gid[0]])


def load(data_dir, catalogue):
    """The catalogue's load order, read from data_dir and held to its bytes."""
    order = [row['name'] for row in catalogue['loadOrder'] if row['name'] != PLUGIN]
    canon = {n.lower(): n for n in order}
    plugins, problems = [], []
    for i, row in enumerate([r for r in catalogue['loadOrder'] if r['name'] != PLUGIN]):
        # Thornswood's own plugins are read where they are made and shipped
        # from, the repository: a game folder holds whichever release last
        # reached it.
        path = own_plugins.plugin_path(data_dir, row['name'])
        if not os.path.isfile(path):
            problems.append('%s is not in %s' % (row['name'], data_dir))
            continue
        p = Plugin(path, row['name'], i)
        sha = hashlib.sha256(p.buf).hexdigest()
        if own_plugins.is_own(row['name']):
            pass
        elif sha != row['sha256']:
            problems.append('%s in %s is not the bytes npc-population.json was built from '
                            '(rebuild the catalogue first: scripts/dev/Build-NpcPopulation.py)'
                            % (row['name'], data_dir))
        p.masters = [canon.get(m.lower(), m) for m in p.masters]
        plugins.append(p)
    if problems:
        raise SystemExit('STOP. the load order is not the one the catalogue was built from:\n  ' +
                         '\n  '.join(problems) + '\nNothing was written.')
    return order, canon, plugins


def winners(plugins, want):
    win = {}
    for p in plugins:
        for e in p.walk(want):
            win[(e.tag, p.gid(e.fid))] = e
    return win


# The package templates a force greet is made from (Skyrim.esm), and the words
# a gate, door or arrival scene is named with.
FORCE_GREET_TEMPLATES = {('skyrim.esm', 0x03C1C4)}  # ForceGreet; ForceGreetFromSitting is found by name
ARRIVAL_SCENE_WORDS = ('gate', 'intro', 'arriv', 'opening', 'welcome', 'greet')


def arrival_talk(plugins, canon):
    """Every quest whose talk fires on reaching a place, a door or a gate,
    with what ties it there. Read from the records, so it is the same list on
    any machine with this load order:

      arrives at a place   the Story Manager starts it on a change of location
      a door names it      a script on a placed door names the quest
      a trigger names it   a script on a placed trigger box names the quest
      a force greet        a ForceGreet package waits on the quest
      a scene              one of its scenes is a gate, intro or arrival scene
    """
    win = winners(plugins, {b'QUST', b'SCEN', b'PACK', b'REFR', b'DOOR'})
    doors = {g for (t, g) in win if t == b'DOOR'}
    quests = {g: e for (t, g), e in win.items() if t == b'QUST'}
    why = collections.defaultdict(set)

    def names(src, e):
        return [(t, b) for t, b in subrecords(src.data(e))]

    templates = set(FORCE_GREET_TEMPLATES)
    for (t, g), e in win.items():
        if t == b'PACK':
            ed = dict(names(plugins[e.pi], e)).get(b'EDID', b'').rstrip(b'\x00').lower()
            if ed in (b'forcegreet', b'forcegreetfromsitting'):
                templates.add(g)
    for (t, g), e in win.items():
        src = plugins[e.pi]
        if t == b'QUST':
            if dict(names(src, e)).get(b'ENAM') == b'CLOC':
                why[g].add('arrives at a place')
        elif t == b'PACK':
            pairs = names(src, e)
            pk = dict(pairs).get(b'PKCU')
            if pk is None or src.gid(struct.unpack_from('<I', pk, 4)[0]) not in templates:
                continue
            for tt, b in pairs:
                if tt == b'CTDA':
                    for off in (12, 16):
                        v = struct.unpack_from('<I', b, off)[0]
                        if v and (v >> 24) <= len(src.masters) and src.gid(v) in quests:
                            why[src.gid(v)].add('a force greet waits on it')
        elif t == b'SCEN':
            pairs = dict(names(src, e))
            ed = pairs.get(b'EDID', b'').rstrip(b'\x00').decode('latin1').lower()
            if b'PNAM' in pairs and any(w in ed for w in ARRIVAL_SCENE_WORDS):
                why[src.gid(struct.unpack('<I', pairs[b'PNAM'])[0])].add('a gate or arrival scene')
        elif t == b'REFR':
            pairs = names(src, e)
            tags = [tt for tt, _ in pairs]
            if b'VMAD' not in tags:
                continue
            base = src.gid(struct.unpack('<I', dict(pairs)[b'NAME'])[0])
            kind = 'a door names it' if base in doors else 'a trigger names it' if b'XPRM' in tags else None
            if kind is None:
                continue
            tree = vmad_parse(dict(pairs)[b'VMAD'], False)
            for o in vmad_objects(tree):
                if o['fid'] and (o['fid'] >> 24) <= len(src.masters) and src.gid(o['fid']) in quests:
                    why[src.gid(o['fid'])].add(kind)
    out = []
    for g in sorted(why):
        e = quests[g]
        ed = dict(names(plugins[e.pi], e)).get(b'EDID', b'').rstrip(b'\x00').decode('latin1')
        out.append({'quest': desc_of(g, canon), 'edid': ed, 'vanilla': g[0] in VANILLA,
                    'why': sorted(why[g])})
    return out


# The hold location records (#2551): the nine holds, and Solstheim for Raven
# Rock, by editor id, the same ones scripts/dev/Build-BuildingHolds.py reads.
HOLD_LOCATIONS = ('WhiterunHoldLocation', 'HaafingarHoldLocation', 'RiftHoldLocation',
                  'ReachHoldLocation', 'EastmarchHoldLocation', 'FalkreathHoldLocation',
                  'HjaalmarchHoldLocation', 'PaleHoldLocation', 'WinterholdHoldLocation',
                  'DLC2SolstheimLocation')


def edid_of(plugins, e):
    return dict(subrecords(plugins[e.pi].data(e))).get(b'EDID', b'').rstrip(b'\x00').decode('latin1')


def form_field(plugins, e, tag):
    """The form id in e's one subrecord tag, as (owner, object id), or None."""
    b = dict(subrecords(plugins[e.pi].data(e))).get(tag)
    if not b or len(b) != 4 or not struct.unpack('<I', b)[0]:
        return None
    return plugins[e.pi].gid(struct.unpack('<I', b)[0])


def hold_of(plugins, win, gid, planned=None):
    """The hold location a location's parent chain reaches, by editor id, or
    None. The location itself counts. planned is {location: its new parent},
    the policy's, read in place of the records' own."""
    seen = set()
    while gid and gid not in seen:
        seen.add(gid)
        e = win.get((b'LCTN', gid))
        if e is None:
            return None
        if edid_of(plugins, e) in HOLD_LOCATIONS:
            return edid_of(plugins, e)
        gid = (planned or {}).get(gid) or form_field(plugins, e, b'PNAM')
    return None


def set_field(pairs, tag, body, before):
    """pairs with tag's bytes as body: in its place when it is there, else
    straight after the last subrecord of before."""
    if any(t == tag for t, _ in pairs):
        return [(t, body if t == tag else b) for t, b in pairs]
    at = max([i + 1 for i, (t, _) in enumerate(pairs) if t in before] or [0])
    return pairs[:at] + [(tag, body)] + pairs[at:]


def place_holds(policy, plugins, win, canon):
    """The policy's placeHolds checked against the load order: [(location
    entry, its new parent's entry, manifest row)] and {cell gid: (cell entry,
    its new location's entry, manifest row)}. A new parent is a hold's own
    location, or a place that the policy itself puts in one (Dead Drop Falls
    in Dayspring Canyon). Stops on anything the policy and the records do not
    agree on, so a collection that moved is decided again, never carried
    over."""
    rules = policy.get('placeHolds') or {}
    planned = {ref_key(r['location']): ref_key(r['parent']) for r in rules.get('locations', [])}
    locs, cells = [], {}
    for row in rules.get('locations', []):
        g = ref_key(row['location'])
        e = win.get((b'LCTN', g))
        pe = win.get((b'LCTN', ref_key(row['parent'])))
        if e is None or edid_of(plugins, e) != row['edid']:
            raise SystemExit('STOP. the policy gives %s (%s) a hold, and no plugin has that location. '
                             'Nothing was written.' % (row['location'], row['edid']))
        if pe is None or edid_of(plugins, pe) != row['parentEdid']:
            raise SystemExit('STOP. the policy gives %s the parent %s (%s), which no plugin has. '
                             'Nothing was written.' % (row['edid'], row['parent'], row['parentEdid']))
        was = form_field(plugins, e, b'PNAM')
        if hold_of(plugins, win, was):
            raise SystemExit('STOP. %s is in %s already, through its parent %s. Take it out of the policy. '
                             'Nothing was written.' % (row['edid'], hold_of(plugins, win, was), desc_of(was, canon)))
        hold = hold_of(plugins, win, g, planned)
        if hold != row['holdEdid'] or hold not in HOLD_LOCATIONS:
            raise SystemExit('STOP. the policy puts %s in %s, and its new parent puts it in %s. '
                             'Nothing was written.' % (row['edid'], row['holdEdid'], hold))
        locs.append((e, pe, {'location': row['location'], 'edid': row['edid'], 'place': row['place'],
                             'wonBy': plugins[e.pi].name,
                             'parentWas': (desc_of(was, canon) + ' ' + edid_of(plugins, win[(b'LCTN', was)]))
                             if was else None,
                             'parent': row['parent'] + ' ' + row['parentEdid'], 'hold': hold}))
    for row in rules.get('cells', []):
        g = ref_key(row['cell'])
        e = win.get((b'CELL', g))
        le = win.get((b'LCTN', ref_key(row['location'])))
        if e is None or edid_of(plugins, e) != row['edid']:
            raise SystemExit('STOP. the policy gives cell %s (%s) a location, and no plugin has that cell. '
                             'Nothing was written.' % (row['cell'], row['edid']))
        if e.ctx[0] is not None:
            raise SystemExit('STOP. cell %s is outside, and the policy only gives a room a location. '
                             'Nothing was written.' % row['cell'])
        was = form_field(plugins, e, b'XLCN')
        if was:
            raise SystemExit('STOP. cell %s (%s) has a location of its own now, %s. Decide it again in the '
                             'policy. Nothing was written.' % (row['cell'], row['edid'], desc_of(was, canon)))
        if le is None or edid_of(plugins, le) != row['locationEdid']:
            raise SystemExit('STOP. the policy gives cell %s the location %s (%s), which no plugin has. '
                             'Nothing was written.' % (row['cell'], row['location'], row['locationEdid']))
        hold = hold_of(plugins, win, ref_key(row['location']), planned)
        if hold != row['holdEdid']:
            raise SystemExit('STOP. the policy puts cell %s in %s, and its location %s is in %s. '
                             'Nothing was written.' % (row['cell'], row['holdEdid'], row['locationEdid'], hold))
        cells[g] = (e, le, {'cell': row['cell'], 'edid': row['edid'], 'place': row['place'],
                            'wonBy': plugins[e.pi].name, 'locationWas': None,
                            'location': row['location'] + ' ' + row['locationEdid'], 'hold': hold})
    return locs, cells


def floor_bases(plugins, win, canon):
    """{base: what it is} for every base whose placed references may not lie in
    the world (#3077): the item types, a light only when it can be carried,
    and the coin purses. win has to hold FLOOR_TYPES and FLOR."""
    out = {}
    for (tag, gid), e in win.items():
        if tag not in FLOOR_TYPES or e.flags & DELETED:
            continue
        if tag == b'LIGH':
            d = dict(subrecords(plugins[e.pi].data(e))).get(b'DATA', b'')
            if len(d) < LIGHT_FLAGS_AT + 4 or not struct.unpack_from('<I', d, LIGHT_FLAGS_AT)[0] & LIGHT_CARRIED:
                continue
        out[gid] = tag.decode()
    for g in COIN_PURSES:
        if (b'FLOR', g) not in win:
            raise SystemExit('STOP. no plugin has the coin purse %s. Read game/data/harvests.json again '
                             'and change COIN_PURSES. Nothing was written.' % desc_of(g, canon))
        out[g] = 'coin purse'
    return out


def floor_scan(plugins, win, bases):
    """Every winning placed reference whose base is in bases, as {ref: (entry,
    what its base is)}, and every placed reference or actor with an enable
    parent, as {ref: (entry, its enable parent)}."""
    floor, parents = {}, {}
    for (tag, gid), e in win.items():
        if tag not in (b'REFR', b'ACHR'):
            continue
        src = plugins[e.pi]
        pairs = dict(subrecords(src.data(e)))
        if b'XESP' in pairs:
            parents[gid] = (e, src.gid(struct.unpack_from('<I', pairs[b'XESP'], 0)[0]))
        if tag == b'REFR' and b'NAME' in pairs:
            kind = bases.get(src.gid(struct.unpack('<I', pairs[b'NAME'])[0]))
            if kind:
                floor[gid] = (e, kind)
    return floor, parents


# A hold-only plant or ore (#3150) is placed in a hold the way the NPC
# catalogue places a person (scripts/dev/Build-CastTable.py, Cast.place): the
# location the reference carries, the location of the cell it stands in, the
# ground under it when it stands in a world's persistent cell, and last the
# nearest ground within HOLD_NEAREST cells that names a place.
HOLD_ONLY = 'hold-only '
CELL_UNITS = 4096.0
HOLD_NEAREST = 6
# The nine holds. Solstheim is a hold location in the records but not one of
# Skyrim's holds, so nothing grows only there.
NINE_HOLDS = HOLD_LOCATIONS[:9]
# The tables whose rows name a placed reference a quest or a trade draws from,
# by its reference field. A hold-only switch-off that reaches one stops the
# build, so the quest is decided rather than emptied.
SOURCE_TABLES = ('merchant-scarce-harvest.json', 'merchant-scarce-geodes.json', 'merchant-scarce-fishing.json',
                 'merchant-orchard.json')


def hold_only_rows(policy):
    """The policy's holdOnly resources checked against the plant and ore
    tables: {base gid: row}, and the rows. A row names its produce, and every
    base of game/data/harvests.json or game/data/ores.json that gives it is
    hold-only."""
    rules = policy.get('holdOnly') or {}
    harvests = json.load(open(os.path.join(ROOT, 'game', 'data', 'harvests.json'), encoding='utf-8'))['harvests']
    ores = json.load(open(os.path.join(ROOT, 'game', 'data', 'ores.json'), encoding='utf-8'))['ores']
    by_base, rows, seen = {}, [], set()
    for row in rules.get('resources', []):
        if row['produce'] in seen:
            raise SystemExit('STOP. the policy makes %s hold-only twice. Nothing was written.' % row['produce'])
        seen.add(row['produce'])
        if row['holdEdid'] not in NINE_HOLDS:
            raise SystemExit('STOP. the policy keeps %s to %s, which is not one of the nine holds. '
                             'Nothing was written.' % (row['name'], row['holdEdid']))
        table, field = (harvests, 'produce') if row['kind'] == 'plant' else (ores, 'ore') \
            if row['kind'] == 'ore' else (None, None)
        if table is None:
            raise SystemExit('STOP. the policy calls %s a %s; a hold-only resource is a plant or an ore. '
                             'Nothing was written.' % (row['name'], row['kind']))
        bases = sorted(b for b, r in table.items() if r[field] == row['produce'])
        names = {table[b]['name'] for b in bases}
        if not bases or names != {row['name']}:
            raise SystemExit('STOP. the policy keeps %s (%s) to its hold, and the %s table gives it from %s. '
                             'Nothing was written.' % (row['produce'], row['name'], row['kind'],
                                                       ', '.join(sorted(names)) or 'nothing'))
        for b in bases:
            if ref_key(b) in by_base:
                raise SystemExit('STOP. %s gives two hold-only resources. Nothing was written.' % b)
            by_base[ref_key(b)] = row
        rows.append(dict(row, bases=bases))
    per = collections.Counter(r['holdEdid'] for r in rows)
    if rows and any(not 2 <= per[h] <= 3 for h in NINE_HOLDS):
        raise SystemExit('STOP. each hold keeps 2 to 3 hold-only resources (Patrick, 22 Oct 2026, #3150), '
                         'and the policy gives %s. Nothing was written.'
                         % ', '.join('%s %d' % (h, per[h]) for h in NINE_HOLDS))
    return by_base, rows


def quest_sources():
    """Every placed reference a quest or trade table draws from, as gids."""
    out = set()
    for name in SOURCE_TABLES:
        path = os.path.join(ROOT, 'game', 'data', name)
        if os.path.isfile(path):
            for row in json.load(open(path, encoding='utf-8')).get('sources', []):
                out.add(ref_key(row['reference']))
    return out


def ref_holds(plugins, win, planned=None, rooms=None):
    """A function giving the hold location's editor id a placed reference
    stands in, or None. planned is {location: its new parent} and rooms
    {cell gid: its new location gid}, the policy's place holds, read in place
    of the records' own (#2551)."""
    ground, named = {}, {}
    for (tag, g), e in win.items():
        if tag != b'CELL' or e.ctx[0] is None or e.ctx[3]:
            continue
        pairs = dict(subrecords(plugins[e.pi].data(e)))
        if len(pairs.get(b'XCLC', b'')) < 8:
            continue
        square = (plugins[e.pi].gid(e.ctx[0]),) + struct.unpack_from('<ii', pairs[b'XCLC'], 0)
        ground[square] = g
        h = hold_of(plugins, win, form_field(plugins, e, b'XLCN'), planned)
        if h:
            named[square] = h

    def cell_hold(cg):
        if cg in (rooms or {}):
            return hold_of(plugins, win, rooms[cg], planned)
        ce = win.get((b'CELL', cg))
        return hold_of(plugins, win, form_field(plugins, ce, b'XLCN'), planned) if ce is not None else None

    def nearest(world, gx, gy):
        for r in range(1, HOLD_NEAREST + 1):
            best = None
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    h = named.get((world, gx + dx, gy + dy))
                    if h and (best is None or (dx * dx + dy * dy, h) < best):
                        best = (dx * dx + dy * dy, h)
            if best:
                return best[1]
        return None

    def place(e):
        src = plugins[e.pi]
        h = hold_of(plugins, win, form_field(plugins, e, b'XLCN'), planned)
        if h:
            return h
        cg = src.gid(e.ctx[1])
        h = cell_hold(cg)
        if h:
            return h
        ce = win.get((b'CELL', cg))
        if ce is None or ce.ctx[0] is None:
            return None
        d = dict(subrecords(src.data(e))).get(b'DATA', b'')
        if len(d) < 8:
            return None
        x, y = struct.unpack_from('<ff', d, 0)
        world, gx, gy = plugins[ce.pi].gid(ce.ctx[0]), int(x // CELL_UNITS), int(y // CELL_UNITS)
        if ce.ctx[3]:
            h = cell_hold(ground.get((world, gx, gy)))
            if h:
                return h
        return nearest(world, gx, gy)

    return place


def build(data_dir):
    catalogue = json.load(open(CATALOGUE, encoding='utf-8'))
    policy = json.load(open(POLICY, encoding='utf-8'))
    order, canon, plugins = load(data_dir, catalogue)
    win = winners(plugins, {b'ACHR', b'REFR', b'CELL', b'WRLD', b'QUST', b'LCTN', b'FLOR', b'COBJ'} | set(FLOOR_TYPES))
    tables = {}

    def strings(src, kind):
        key = (src.name, kind)
        if key not in tables:
            tables[key] = string_table(data_dir, src.name, kind)
        return tables[key]

    # 1. The cut actors.
    keep_corpses = policy['corpses']['action'] == 'keep'
    refs = {'disabled': [], 'deleted': [], 'alreadyOff': [], 'corpseKept': [], 'heldByServer': []}
    actors, actor_ref = [], {}
    for row in catalogue['npcs']:
        if row['keep'] or row['ref'] == '14:Skyrim.esm':
            continue
        e = win.get((b'ACHR', ref_key(row['ref'])))
        if e is None:
            raise SystemExit('STOP. the catalogue cuts %s and no plugin places it. Nothing was written.'
                             % row['ref'])
        src = plugins[e.pi]
        tags = [t for t, _ in subrecords(src.data(e))]
        if e.flags & DELETED:
            refs['deleted'].append(row['ref'])
        elif e.flags & DISABLED and b'XESP' not in tags:
            refs['alreadyOff'].append(row['ref'])
        elif keep_corpses and row['reason'] == 'Authored corpse, not a living encounter':
            refs['corpseKept'].append(row['ref'])
        else:
            refs['disabled'].append(row['ref'])
            actors.append(e)
            actor_ref[(e.pi, e.fid)] = row['ref']

    # 2. The quests.
    kept_ids = {ref_key(q['quest']): q for q in policy['questsKept']}
    prefixes = tuple(policy.get('questEditorIdPrefixesKept', {}).keys())
    quests_cut, quests_kept = [], []
    qentries = []
    for (tag, gid), e in sorted(win.items()):
        if tag != b'QUST' or gid[0] not in VANILLA:
            continue
        src = plugins[e.pi]
        edid = dict(subrecords(src.data(e))).get(b'EDID', b'').rstrip(b'\x00').decode('latin1')
        row = {'quest': desc_of(gid, canon), 'edid': edid}
        if gid in kept_ids:
            if kept_ids[gid]['edid'] != edid:
                raise SystemExit('STOP. the policy keeps %s as %s, and it is %s. Nothing was written.'
                                 % (row['quest'], kept_ids[gid]['edid'], edid))
            quests_kept.append(dict(row, why=kept_ids[gid]['group']))
        elif prefixes and edid.startswith(prefixes):
            quests_kept.append(dict(row, why=next(policy['questEditorIdPrefixesKept'][p]
                                                   for p in prefixes if edid.startswith(p))))
        else:
            quests_cut.append(row)
            qentries.append(e)
    missing = set(kept_ids) - {ref_key(q['quest']) for q in quests_kept}
    if missing:
        raise SystemExit('STOP. the policy keeps quests no master has: %s. Nothing was written.'
                         % ', '.join(desc_of(g, canon) for g in sorted(missing)))
    mod_stopped = []
    for q in policy.get('modQuestsStopped', []):
        gid = ref_key(q['quest'])
        e = win.get((b'QUST', gid))
        if gid[0] in VANILLA or e is None:
            raise SystemExit('STOP. the policy stops %s as a mod quest, and no mod has it. '
                             'Nothing was written.' % q['quest'])
        edid = dict(subrecords(plugins[e.pi].data(e))).get(b'EDID', b'').rstrip(b'\x00').decode('latin1')
        if edid != q['edid']:
            raise SystemExit('STOP. the policy stops %s as %s, and it is %s. Nothing was written.'
                             % (q['quest'], q['edid'], edid))
        mod_stopped.append({'quest': desc_of(gid, canon), 'edid': edid})
        qentries.append(e)
    # 7. The script properties set on mod quests (#3101).
    stopped_here = {plugins[e.pi].gid(e.fid) for e in qentries}
    qprops, qprop_rows = [], []
    for row in (policy.get('questScriptProperties') or {}).get('quests', []):
        gid = ref_key(row['quest'])
        e = win.get((b'QUST', gid))
        if gid[0] in VANILLA or e is None:
            raise SystemExit('STOP. the policy sets script properties on %s as a mod quest, and no mod has it. '
                             'Nothing was written.' % row['quest'])
        edid = edid_of(plugins, e)
        if edid != row['edid']:
            raise SystemExit('STOP. the policy sets script properties on %s as %s, and it is %s. '
                             'Nothing was written.' % (row['quest'], row['edid'], edid))
        if gid in stopped_here or gid in {plugins[x.pi].gid(x.fid) for x, _ in qprops}:
            raise SystemExit('STOP. the policy stops %s and sets its script properties too, or sets them twice. '
                             'Decide which. Nothing was written.' % row['quest'])
        qprops.append((e, row))
        qprop_rows.append({'quest': desc_of(gid, canon), 'edid': edid, 'script': row['script'],
                           'winner': plugins[e.pi].name,
                           'set': {p['name']: p['value'] for p in row['properties']}})

    # 3. The town gates (#2484), each the winning record, unlocked.
    gates = []
    for g in GATES:
        e = win.get((b'REFR', g))
        what = '%x:%s' % (g[1], canon[g[0]])
        if e is None:
            raise SystemExit('STOP. no plugin places the town gate %s. Nothing was written.' % what)
        if b'XLOC' not in [t for t, _ in subrecords(plugins[e.pi].data(e))]:
            raise SystemExit('STOP. the town gate %s already has no lock in %s; take it off GATES. '
                             'Nothing was written.' % (what, plugins[e.pi].name))
        gates.append(e)

    # Nothing is copied out of a plugin the policy says is never handed on
    # (notCopiedFrom: Patrick, 17 Oct 2026, Immersive Armors is used as-is
    # through the collection and nothing built from it is redistributed). A
    # cell it wins is copied from the plugin that wins it below, and only when
    # its own record says nothing more (compared below, after the numbering);
    # any other record it wins stops the build. A floor item it wins but
    # does not place is switched off from the plugin below it: off, the
    # reference shows nothing of either. The only records of it copied are the
    # ones its row names under carried, each by tag and id; one named there
    # that this build does not need stops it, so the list stays exactly what
    # Patrick allowed. Immersive Armors carries none (Patrick, 22 Oct 2026,
    # q-613-ia-recipes: the 6 floor items it places and their 5 cell and
    # world headers were never his to carry); those floor items are held off
    # by the server (heldByServer below). The one other thing copied out of
    # such a plugin is its recipes that test a perk, with only those tests
    # taken out, when its row says perkRecipesCopied (9; Patrick, 31 Oct
    # 2026, A on q-4826-ia-perk-recipes).
    blocked = {row['plugin'].lower() for row in policy.get('notCopiedFrom', [])}
    perks_off = perk_recipes_copied(policy)
    carried = {r.lower(): r for row in policy.get('notCopiedFrom', []) for r in row.get('carried', [])}
    used = set()
    below = {}

    def carries(tag, g):
        """Whether the policy carries the record tag g from the never-copied plugin that wins it."""
        k = ('%s %s' % (tag.decode(), desc_of(g, canon))).lower()
        if k in carried:
            used.add(k)
            return True
        return False

    def under(e, tag, gid):
        """The record tag gid as the highest plugin below e's has it, or None."""
        for i in range(e.pi - 1, -1, -1):
            if plugins[i].name.lower() in blocked:
                continue
            if (i, tag) not in below:
                below[(i, tag)] = {plugins[i].gid(x.fid): x for x in plugins[i].walk({tag})}
            if gid in below[(i, tag)]:
                return below[(i, tag)][gid]
        return None

    def placed(e):
        """What a placed reference is and where, for a person to decide it."""
        if e.tag not in (b'REFR', b'ACHR'):
            return ''
        src = plugins[e.pi]
        b = src.gid(struct.unpack('<I', dict(subrecords(src.data(e)))[b'NAME'])[0])
        be = next((win[(t, b)] for t in FLOOR_TYPES + (b'FLOR', b'ACHR') if (t, b) in win), None)
        ce = win.get((b'CELL', src.gid(e.ctx[1]))) if e.ctx[1] is not None else None
        return ': %s %s%s' % (be.tag.decode() if be else '?', edid_of(plugins, be) if be else desc_of(b, canon),
                              (' in ' + (edid_of(plugins, ce) or desc_of(src.gid(e.ctx[1]), canon))) if ce else '')

    # 4. The floor items (#3077): every placed reference a person could pick
    # up, switched off like a cut actor. Left alone, the same way: one a later
    # plugin deleted, and one already off with no enable parent. The
    # hold-only plants and ores (10, #3150) are found in the same pass.
    bases = floor_bases(plugins, win, canon)
    hold_bases, hold_rows = hold_only_rows(policy)
    scan = dict(bases)
    for g, row in hold_bases.items():
        if g in bases:
            raise SystemExit('STOP. %s is a floor item and a hold-only %s at once. Nothing was written.'
                             % (desc_of(g, canon), row['kind']))
        scan[g] = HOLD_ONLY + row['produce']
    found, parents = floor_scan(plugins, win, scan)
    hold_found = {g: v for g, v in found.items() if v[1].startswith(HOLD_ONLY)}
    found = {g: v for g, v in found.items() if not v[1].startswith(HOLD_ONLY)}

    def in_blocked_place(e):
        """Whether e stands in a cell or world a never-copied plugin wins."""
        src = plugins[e.pi]
        world, cell = e.ctx[0], e.ctx[1]
        for tag, fid in ((b'CELL', cell), (b'WRLD', world)):
            w = win.get((tag, src.gid(fid))) if fid is not None else None
            if w is not None and plugins[w.pi].name.lower() in blocked and not carries(tag, src.gid(fid)):
                return True
        return False

    def sort_off(g, e, kind, off, rows, server):
        """Where one placed reference to switch off goes: off (switched off
        here, from the record that is copied), rows (deleted or already off,
        left alone) or server (held off by the server)."""
        src = plugins[e.pi]
        tags = [t for t, _ in subrecords(src.data(e))]
        if e.flags & DELETED:
            rows['deleted'].append(desc_of(g, canon))
        # Off already only with nothing that could switch it on: no enable
        # parent and no script. A disabled item with a script is switched off
        # here, without the script.
        elif e.flags & DISABLED and b'XESP' not in tags and b'VMAD' not in tags:
            rows['alreadyOff'].append(desc_of(g, canon))
        elif in_blocked_place(e):
            # It stands in a cell or world a never-copied plugin wins, so
            # switching it off here would copy that plugin's record of the
            # place, or undo its edit with the one below. The server holds
            # it off instead.
            server.append((g, kind))
        elif src.name.lower() in blocked and not carries(b'REFR', g):
            if under(e, b'REFR', g) is not None:
                off.append((g, under(e, b'REFR', g), kind))
            elif canon[g[0]].lower() in blocked:
                # Its own, placed by it: nothing below to switch off, and its
                # record is not copied. The server holds it off.
                server.append((g, kind))
            else:
                raise SystemExit('STOP. %s wins %s %s and no plugin below it has it. Nothing was '
                                 'written.' % (src.name, kind, desc_of(g, canon)))
        else:
            off.append((g, e, kind))

    floor, floor_rows, by_server = [], {'deleted': [], 'alreadyOff': []}, []
    for g in sorted(found, key=lambda g: (canon[g[0]].lower(), g[1])):
        e, kind = found[g]
        src = plugins[e.pi]
        if own_plugins.is_own(canon[g[0]]) or own_plugins.is_own(src.name):
            raise SystemExit('STOP. %s puts %s on the floor (a %s). A Thornswood plugin\'s own floor item '
                             'is Patrick\'s to keep or take out (#3077), never switched off unasked. '
                             'Nothing was written.' % (src.name, desc_of(g, canon), kind))
        sort_off(g, e, kind, floor, floor_rows, by_server)

    # 10. The hold-only plants and ores (#3150). Patrick, 22 Oct 2026 (page
    # answer A): each hold has 2 to 3 hold-only plants, ores or animals, which
    # grow only in their own hold. Every placed one of them standing anywhere
    # but its own hold is switched off the way a floor item is; the ones in
    # their hold stay. A Thornswood plugin's own placement outside its hold,
    # and one a quest or trade table draws from, stop the build, so each is
    # decided rather than switched off unasked.
    hold_planned = {ref_key(r['location']): ref_key(r['parent'])
                    for r in (policy.get('placeHolds') or {}).get('locations', [])}
    hold_rooms = {ref_key(r['cell']): ref_key(r['location'])
                  for r in (policy.get('placeHolds') or {}).get('cells', [])}
    hold_place = ref_holds(plugins, win, hold_planned, hold_rooms)
    sources = quest_sources()
    hold_off, hold_left, hold_server = [], {'deleted': [], 'alreadyOff': []}, []
    hold_by_produce = {r['produce']: r for r in hold_rows}
    hold_count = {r['produce']: collections.Counter() for r in hold_rows}
    for g in sorted(hold_found, key=lambda g: (canon[g[0]].lower(), g[1])):
        e, kind = hold_found[g]
        src = plugins[e.pi]
        row = hold_by_produce[kind[len(HOLD_ONLY):]]
        where = hold_place(e)
        if where == row['holdEdid']:
            hold_count[row['produce']]['kept'] += 1
            continue
        if own_plugins.is_own(canon[g[0]]) or own_plugins.is_own(src.name):
            raise SystemExit('STOP. %s places %s %s in %s, outside %s. A Thornswood plugin\'s own placement '
                             'is Patrick\'s to keep or take out (#3150), never switched off unasked. '
                             'Nothing was written.' % (src.name, row['name'], desc_of(g, canon), where or 'no hold',
                                                       row['holdEdid']))
        if g in sources:
            raise SystemExit('STOP. %s %s stands in %s, outside %s, and a quest or trade table draws from it '
                             '(game/data/%s). Decide it on #3150. Nothing was written.'
                             % (row['name'], desc_of(g, canon), where or 'no hold', row['holdEdid'],
                                ' or '.join(SOURCE_TABLES)))
        hold_count[row['produce']]['outside'] += 1
        sort_off(g, e, row['name'], hold_off, hold_left, hold_server)
    # A reference whose enable parent is a floor item would go out with it, or
    # come on as it goes (the opposite flag). Neither is decided by this. Only
    # a floor item's followers count: a cut actor's go out with it, as they
    # have since #2468 (measured 21 Oct 2026: 30 references follow 11 cut
    # actors, and none follows a floor item). A follower that is switched off
    # here itself, a floor item or a cut actor, has no enable parent left.
    # A hold-only plant or ore switched off counts the same way (#3150).
    items_off = {g for g, _, _ in floor + hold_off}
    off_here = items_off | {plugins[e.pi].gid(e.fid) for e in actors}
    followers = sorted('%s follows %s' % (desc_of(g, canon), desc_of(p, canon))
                       for g, (e, p) in parents.items() if p in items_off and g not in off_here)
    if followers:
        raise SystemExit('STOP. %d reference(s) have a floor item or a hold-only plant or ore as their enable '
                         'parent, and switching it off would switch them too:\n  %s\nDecide them on #3077 or '
                         '#3150. Nothing was written.' % (len(followers), '\n  '.join(followers[:40])))

    # The cells and worlds the actors, gates and floor items stand in, each
    # from its own winner.
    cells, worlds = {}, {}

    def stand(e):
        src = plugins[e.pi]
        world, cell, child, block, sub = e.ctx
        if cell is None or child not in (8, 9):
            raise SystemExit('STOP. %s 0x%08X is not inside a cell. Nothing was written.'
                             % (src.name, e.fid))
        cg = src.gid(cell)
        if (b'CELL', cg) not in win:
            raise SystemExit('STOP. no plugin carries the cell of %s 0x%08X. Nothing was written.'
                             % (src.name, e.fid))
        cells[cg] = win[(b'CELL', cg)]
        if world is not None:
            wg = src.gid(world)
            worlds[wg] = win[(b'WRLD', wg)]
            cw = cells[cg].ctx[0]
            if cw is None or plugins[cells[cg].pi].gid(cw) != wg:
                raise SystemExit('STOP. %s 0x%08X stands in a world its cell is not in. '
                                 'Nothing was written.' % (src.name, e.fid))
        return cg

    # A cut actor standing where a never-copied plugin wins the cell or world
    # is held off by the server, for the floor items' reason (heldByServer).
    for e in [e for e in actors if in_blocked_place(e)]:
        actors.remove(e)
        refs['disabled'].remove(actor_ref[(e.pi, e.fid)])
        refs['heldByServer'].append(actor_ref[(e.pi, e.fid)])
    for e in actors + gates:
        stand(e)
    # The cells only the floor items need: what this adds to the records the
    # plugin copies from other authors (#2791), counted by who wins each.
    had = set(cells)
    floor_cells = {stand(e) for _, e, _ in floor} - had
    # And the ones only the hold-only plants and ores need (#3150).
    had = set(cells)
    hold_only_cells = {stand(e) for _, e, _ in hold_off} - had

    # 5. The places given a hold (#2551). A room given a location is copied
    # like any other cell, with nothing placed under it unless an actor here
    # stands in it too.
    hold_locs, hold_cells = place_holds(policy, plugins, win, canon)
    for g, (e, le, row) in hold_cells.items():
        cells[g] = e
    floor_cells -= set(hold_cells)
    hold_only_cells -= set(hold_cells)

    # 5. The re-costed smith recipes (#613).
    recipes = recost_entries(json.load(open(RECOST, encoding='utf-8')), plugins, win)

    # 8. The recipes moved to their trade's bench (#3120). One a never-copied
    # plugin has, or wins, is moved in each person's game instead.
    moves, moved_in_game = move_entries(json.load(open(RECIPES, encoding='utf-8')), plugins, win, canon,
                                        blocked, carries)

    # 9. The recipes freed of Skyrim's perks (#4826).
    perk_recipes, perk_stats = perk_entries(plugins, win, canon, blocked, perks_off)

    # 6. Nothing is copied out of a plugin the policy never copies from
    # (notCopiedFrom, above) but what it carries; anything else it would
    # contribute stops the build, and so does a carried record not needed.
    # A re-costed recipe is a copy of its record too, so one that is a
    # never-copied plugin's own, or won by one, stops it unless carried
    # (Build-Recost.py lists those under notCopied instead).
    held = sorted('%s %s (won by %s)%s' % (e.tag.decode(), desc_of(plugins[e.pi].gid(e.fid), canon),
                                           plugins[e.pi].name, placed(e))
                  for e in actors + gates + qentries + [e for e, _ in qprops] +
                  [e for e, _, _ in hold_locs]
                  if plugins[e.pi].name.lower() in blocked)
    for e, row in recipes:
        g = plugins[e.pi].gid(e.fid)
        if (plugins[e.pi].name.lower() in blocked or row['recipe'].split(':', 1)[1].lower() in blocked) \
                and not carries(b'COBJ', g):
            held.append('COBJ %s (re-costed by recost.json, won by %s)' % (desc_of(g, canon), plugins[e.pi].name))
    swapped = []
    for kind, table in ((b'CELL', cells), (b'WRLD', worlds)):
        for g, e in list(table.items()):
            if plugins[e.pi].name.lower() not in blocked or carries(kind, g):
                continue
            prev = under(e, kind, g)
            if prev is None:
                held.append('%s %s (only %s has it)' % (kind.decode(), desc_of(g, canon), plugins[e.pi].name))
                continue
            table[g] = prev
            swapped.append((kind, g, e, prev))
    stale = [carried[k] for k in sorted(set(carried) - used)]

    # Two passes over the same copies: names first, then numbers.
    rn = Renumber()

    def copies():
        out = {'achr': [], 'refr': [], 'cell': {}, 'wrld': {}, 'qust': [], 'lctn': [], 'cobj': []}
        for e in gates:
            src = plugins[e.pi]
            what = '%s REFR 0x%08X' % (src.name, e.fid)
            keep = []
            for t, b in subrecords(src.data(e)):
                if t in GATE_DROP:
                    continue
                if t in GATE_FID_FIRST:
                    if len(b) < 4:
                        raise SystemExit('STOP. %s %s is too short for a form id. Nothing was written.'
                                         % (what, t.decode()))
                    b = struct.pack('<I', rn.one(src, struct.unpack_from('<I', b, 0)[0], what)) + b[4:]
                elif t not in GATE_PLAIN:
                    raise SystemExit('STOP. %s carries %s, which this does not know how to copy. '
                                     'Nothing was written.' % (what, t.decode()))
                keep.append((t, b))
            out['refr'].append((rn.one(src, e.fid, what), e.flags & ~COMPRESSED,
                                pack_subrecords(keep), e))
        for e in actors:
            src = plugins[e.pi]
            what = '%s ACHR 0x%08X' % (src.name, e.fid)
            keep = []
            for t, b in subrecords(src.data(e)):
                if t == b'NAME':
                    keep.append((t, struct.pack('<I', rn.one(src, struct.unpack('<I', b)[0], what))))
                elif t in (b'EDID', b'DATA'):
                    keep.append((t, b))
            if [t for t, _ in keep] not in ([b'NAME', b'DATA'], [b'EDID', b'NAME', b'DATA']):
                raise SystemExit('STOP. %s does not have its base and its position. Nothing was written.'
                                 % what)
            fid = rn.one(src, e.fid, what)
            flags = (e.flags & ~(COMPRESSED | DELETED)) | DISABLED
            out['achr'].append((fid, flags, pack_subrecords(keep), e))
        # A floor item the same way: its base and its place, nothing else.
        # A hold-only plant or ore outside its hold too (#3150).
        for g, e, kind in floor + hold_off:
            src = plugins[e.pi]
            what = '%s REFR 0x%08X' % (src.name, e.fid)
            keep = []
            for t, b in subrecords(src.data(e)):
                if t == b'NAME':
                    keep.append((t, struct.pack('<I', rn.one(src, struct.unpack('<I', b)[0], what))))
                elif t in (b'EDID', b'DATA'):
                    keep.append((t, b))
            if [t for t, _ in keep] not in ([b'NAME', b'DATA'], [b'EDID', b'NAME', b'DATA']):
                raise SystemExit('STOP. %s does not have its base and its position. Nothing was written.'
                                 % what)
            flags = (e.flags & ~(COMPRESSED | DELETED)) | DISABLED
            out['refr'].append((rn.one(src, e.fid, what), flags, pack_subrecords(keep), e))
        for g, e in cells.items():
            src = plugins[e.pi]
            what = '%s CELL 0x%08X' % (src.name, e.fid)
            pairs = copy_record(src, e, rn, strings, what)
            if g in hold_cells:
                le = hold_cells[g][1]
                pairs = set_field(pairs, b'XLCN', struct.pack('<I', rn.one(plugins[le.pi], le.fid, what)),
                                  CELL_BEFORE_XLCN)
            out['cell'][g] = (rn.one(src, e.fid, what), e.flags & ~COMPRESSED, pack_subrecords(pairs), e)
        for e, pe, row in hold_locs:
            src = plugins[e.pi]
            what = '%s LCTN 0x%08X' % (src.name, e.fid)
            pairs = copy_record(src, e, rn, strings, what)
            pairs = set_field(pairs, b'PNAM', struct.pack('<I', rn.one(plugins[pe.pi], pe.fid, what)),
                              LCTN_BEFORE_PNAM)
            out['lctn'].append((rn.one(src, e.fid, what), e.flags & ~COMPRESSED, pack_subrecords(pairs), e))
        for g, e in worlds.items():
            src = plugins[e.pi]
            what = '%s WRLD 0x%08X' % (src.name, e.fid)
            out['wrld'][g] = (rn.one(src, e.fid, what), e.flags & ~COMPRESSED,
                              pack_subrecords(copy_record(src, e, rn, strings, what)), e)
        for e in qentries:
            src = plugins[e.pi]
            what = '%s QUST 0x%08X' % (src.name, e.fid)
            pairs = copy_record(src, e, rn, strings, what)
            pairs = stop_quest(pairs, what)
            out['qust'].append((rn.one(src, e.fid, what), e.flags & ~COMPRESSED,
                                pack_subrecords(pairs), e))
        for e, row in qprops:
            src = plugins[e.pi]
            what = '%s QUST 0x%08X' % (src.name, e.fid)
            pairs = set_properties(copy_record(src, e, rn, strings, what), row, what)
            out['qust'].append((rn.one(src, e.fid, what), e.flags & ~COMPRESSED,
                                pack_subrecords(pairs), e))
        # A recipe re-costed, moved and freed of its perks is one record
        # carrying all three.
        cobjs = collections.OrderedDict()
        for e, row in recipes:
            cobjs.setdefault((e.pi, e.fid), [e, None, None, False])[1] = row
        for e, kw, row in moves:
            cobjs.setdefault((e.pi, e.fid), [e, None, None, False])[2] = kw
        for e in perk_recipes:
            cobjs.setdefault((e.pi, e.fid), [e, None, None, False])[3] = True
        for e, cost, kw, perks in cobjs.values():
            src = plugins[e.pi]
            what = '%s COBJ 0x%08X' % (src.name, e.fid)
            pairs = copy_record(src, e, rn, strings, what)
            if cost is not None:
                pairs = recount(pairs, cost)
            if kw is not None:
                pairs = rebench(pairs, struct.pack('<I', rn.gid(kw)), what)
            if perks:
                pairs = without_perks(pairs, what)
            out['cobj'].append((rn.one(src, e.fid, what), e.flags & ~COMPRESSED,
                                pack_subrecords(pairs), e))
        return out

    copies()
    rn.named.add('skyrim.esm')  # NEVER_TRUE names Gold001
    rn.masters = [n.lower() for n in order if n.lower() in rn.named]
    # A swapped cell or world is right only if the never-copied plugin's own
    # record says nothing the one below does not: then nothing of it is lost
    # and nothing of it is handed on. Compared field by field in this plugin's
    # numbering, names written out.
    differs = []
    for kind, g, e, prev in swapped:
        what = '%s %s' % (kind.decode(), desc_of(g, canon))
        try:
            mine = copy_record(plugins[e.pi], e, rn, strings, what)
            theirs = copy_record(plugins[prev.pi], prev, rn, strings, what)
            changed = sorted({t.decode() for t, b in mine if (t, b) not in theirs} |
                             {t.decode() for t, b in theirs if (t, b) not in mine})
        except (ValueError, SystemExit) as x:
            changed = ['names a record no copy here names (%s)' % str(x).split('\n')[0][:80]]
        if changed:
            differs.append('%s: %s changes it from %s (%s)' % (what, plugins[e.pi].name, plugins[prev.pi].name,
                                                                ', '.join(changed)))
    if held or differs or stale:
        raise SystemExit('STOP. %d record(s) the plugin would copy are won by a plugin the policy never '
                         'copies from (notCopiedFrom):\n  %s\n%d record(s) are changed by one, so neither its '
                         'record nor the one below is right to copy:\n  %s\n%d record(s) the policy carries '
                         'from one are not needed by this build (take them off carried):\n  %s\n'
                         'Decide them on #3077. Nothing was written.'
                         % (len(held), '\n  '.join(sorted(held)[:60]) or 'none',
                            len(differs), '\n  '.join(sorted(differs)[:60]) or 'none',
                            len(stale), '\n  '.join(stale) or 'none'))
    made = copies()
    masters = [canon[m] for m in rn.masters]
    plugin = write_plugin(made, masters, plugins, rn)
    recipe, recipe_stats = make_recipe(plugin, made, plugins)
    manifest = {
        'version': 1,
        'builtBy': 'scripts/mods/Build-LastPlugin.py',
        'issue': 2468,
        'plugin': {'name': PLUGIN, 'size': len(plugin), 'sha256': hashlib.sha256(plugin).hexdigest()},
        'loadOrder': order,
        # The exact bytes every plugin in that order had when this was built
        # (#2486). The plugin copies their winning records, so it is only
        # right for these bytes: a release (Ship-Rules.ps1,
        # Get-ShipLastPluginProblem) and the build check
        # (tests/test-2468-last-plugin.js, against the collection's record)
        # refuse it for any other.
        'builtAgainst': [{'name': p.name, 'size': len(p.buf),
                          'sha256': hashlib.sha256(p.buf).hexdigest()} for p in plugins],
        'masters': masters,
        'counts': {'actorsOff': len(refs['disabled']), 'cells': len(made['cell']),
                   'worlds': len(made['wrld']), 'questsStopped': len(quests_cut),
                   'modQuestsStopped': len(mod_stopped),
                   'questsKept': len(quests_kept), 'gatesUnlocked': len(gates),
                   'placeLocations': len(made['lctn']), 'placeRooms': len(hold_cells),
                   'recipesRecosted': len(recipes), 'recipesMoved': len(moves),
                   'recipesMovedInGame': len(moved_in_game), 'questScriptProperties': len(qprops),
                   'recipesPerksOff': len(perk_recipes)},
        'refs': {k: sorted(v, key=ref_key) for k, v in refs.items()},
        'gatesUnlocked': [desc_of(g, canon) for g in GATES],
        'quests': {'stopped': quests_cut, 'kept': quests_kept, 'modStopped': mod_stopped},
        # The mod quests whose script properties are set here (#3101), each
        # with the plugin whose record it is a copy of.
        'questScriptProperties': qprop_rows,
        # The places given a hold (#2551): each location's parent before and
        # after, and each room's location.
        'placeHolds': {'locations': [row for _, _, row in hold_locs],
                       'rooms': [hold_cells[g][2] for g in sorted(hold_cells)]},
        'arrivalTalk': arrival_talk(plugins, canon),
        # The smith recipes re-costed from game/data/recost.json (#613), each
        # input as [item, count it had, count it has here].
        'recost': [{'recipe': row['recipe'], 'editorId': row['editorId'],
                    'inputs': [[i['item'], i['count'], i['to']] for i in row['inputs']]}
                   for _, row in recipes],
        # The recipes moved to their trade's bench (#3120): from the bench
        # their mod put them at to the one recipes.json makes them at, here,
        # or in each person's game for a plugin never copied from.
        'benchMoves': [{'recipe': row['recipe'], 'editorId': row['editorId'], 'from': row['movedFrom'],
                        'to': row['bench']} for _, _, row in moves],
        'benchMovesInGame': moved_in_game,
        # The recipes freed of Skyrim's perks (#4826), counted rather than
        # listed (there are thousands): how many recipes and conditions, by
        # the plugin whose record each copy is, which perks were tested and
        # how often, and the recipes a never-copied plugin keeps behind them.
        'perks': perk_stats,
        # The floor items switched off (#3077), counted rather than listed
        # (there are tens of thousands); refsSha256 is the sha256 of every one,
        # 'object id:plugin' sorted and joined by newlines, which
        # tests/test-3077-floor-items.js reads back out of the plugin itself.
        'floorItems': {
            'off': len(floor),
            'byType': dict(sorted(collections.Counter(k for _, _, k in floor).items())),
            'byWinner': dict(sorted(collections.Counter(plugins[e.pi].name for _, e, _ in floor).items())),
            'refsSha256': hashlib.sha256('\n'.join(sorted(desc_of(g, canon) for g, _, _ in floor))
                                         .encode('utf-8')).hexdigest(),
            'deleted': len(floor_rows['deleted']),
            'alreadyOff': len(floor_rows['alreadyOff']),
            # Placed by a plugin never copied from: not in the plugin, held
            # off by the server (the gamemode's HELD_BY_SERVER table).
            'heldByServer': sorted(desc_of(g, canon) for g, _ in by_server),
            'cellsAdded': len(floor_cells),
            'cellsAddedByWinner': dict(sorted(collections.Counter(plugins[cells[g].pi].name
                                                                  for g in floor_cells).items())),
        },
    }
    manifest['counts']['floorItemsOff'] = len(floor)
    # The hold-only plants and ores (#3150): each with how many of its
    # placements stand in its hold and stay, and how many stand outside it,
    # and every one switched off here, listed, with the ones left as they are
    # and the ones the server holds off. Only once the policy names one, so
    # a plugin built from a policy with no holdOnly is the one it was.
    if hold_rows:
        manifest['holdOnly'] = {
            'resources': [{'produce': r['produce'], 'name': r['name'], 'kind': r['kind'], 'hold': r['holdEdid'],
                           'bases': len(r['bases']), 'kept': hold_count[r['produce']]['kept'],
                           'outside': hold_count[r['produce']]['outside']} for r in hold_rows],
            'off': sorted(desc_of(g, canon) for g, _, _ in hold_off),
            'deleted': sorted(hold_left['deleted']),
            'alreadyOff': sorted(hold_left['alreadyOff']),
            'heldByServer': sorted(desc_of(g, canon) for g, _ in hold_server),
            'cellsAdded': len(hold_only_cells),
        }
        manifest['counts']['holdOnlyOff'] = len(hold_off)
    # The recipe each machine builds the plugin from (#2791): its bytes, how
    # many plugins and string tables it reads, and how much of the plugin
    # it writes as Thornswood's own (headers, renumbered form ids, the
    # build's own values) rather than copying from those.
    manifest['recipe'] = {'name': os.path.basename(RECIPE), 'size': len(recipe),
                          'sha256': hashlib.sha256(recipe).hexdigest(),
                          'sources': recipe_stats['sources'], 'records': recipe_stats['records'],
                          'ownBytes': recipe_stats['litBytes'],
                          'ownBytesInRecords': recipe_stats['litInRecords'],
                          'addedSubrecords': dict(sorted(recipe_stats['addedSubrecords'].items()))}
    # The cells and worlds a never-copied plugin wins, copied from the plugin
    # below it, whose record that plugin does not change (step 6), and the
    # records the policy carries from it.
    manifest['notCopiedFrom'] = {
        'plugins': sorted(row['plugin'] for row in policy.get('notCopiedFrom', [])),
        'takenFromBelow': sorted('%s %s from %s, not %s' % (k.decode(), desc_of(g, canon), plugins[p.pi].name,
                                                            plugins[e.pi].name) for k, g, e, p in swapped),
        'carried': sorted(carried[k] for k in used),
    }
    return plugin, manifest, recipe


def make_recipe(plugin, made, plugins):
    """The recipe for the plugin (scripts/mods/last_recipe.py, #2791), held
    to make these exact bytes back from the plugins and tables it read."""
    index = {}
    for tag, rows in ((b'ACHR', made['achr']), (None, made['refr']), (b'CELL', made['cell'].values()),
                      (b'WRLD', made['wrld'].values()), (b'QUST', made['qust']), (b'LCTN', made['lctn']),
                      (b'COBJ', made['cobj'])):
        for fid, flags, data, e in rows:
            key = (tag or e.tag, fid)
            if key in index:
                raise SystemExit('STOP. the build made %s 0x%08X twice. Nothing was written.' % (key[0].decode(), fid))
            index[key] = (data, e)
    tables = {}
    for (name, kind), (fname, data) in RAW_TABLES.items():
        tables[(name, kind)] = (fname, data)
    try:
        recipe, stats = last_recipe.make(plugin, index, plugins, tables, PLUGIN)
        by_name = {p.name.lower(): p.buf for p in plugins}
        by_table = {fname.lower(): data for fname, data in tables.values()}
        again = last_recipe.apply(recipe, lambda n: by_name.get(n.lower()), lambda n: by_table.get(n.lower()))
    except last_recipe.RecipeError as x:
        raise SystemExit('STOP. the recipe for %s: %s. Nothing was written.' % (PLUGIN, x))
    if again != plugin:
        raise SystemExit('STOP. the recipe does not make %s back byte for byte. Nothing was written.' % PLUGIN)
    return recipe, stats


def is_perk_test(b):
    """Whether a CTDA's bytes are a HasPerk test (#4826)."""
    return len(b) >= 10 and struct.unpack_from('<H', b, 8)[0] == HAS_PERK


def perk_tests(pairs):
    """The indexes of the HasPerk conditions (#4826) among a record's
    subrecords, and whether any of them is joined to another condition by
    OR: its own OR flag, or the one of the condition before it."""
    at, joined, prev_or = [], False, False
    for i, (t, b) in enumerate(pairs):
        if t != b'CTDA':
            continue
        is_or = len(b) > 0 and bool(b[0] & CTDA_OR)
        if is_perk_test(b):
            at.append(i)
            if is_or or prev_or:
                joined = True
        prev_or = is_or
    return at, joined


def perk_drops(pairs):
    """The indexes of the conditions that come off a recipe (#4826): every
    OR group that holds a perk test, whole, since the test counts as passed
    and so does the group. A group is a run of conditions each joined to the
    next by its OR flag, ended by one without it (or by the last); a lone
    condition is a group of one. Groups are joined to each other by AND, so
    taking one out leaves the others meaning what they meant."""
    groups, cur = [], []
    for i, (t, b) in enumerate(pairs):
        if t != b'CTDA':
            continue
        cur.append(i)
        if not (len(b) > 0 and b[0] & CTDA_OR):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    return [i for g in groups if any(is_perk_test(pairs[j][1]) for j in g) for i in g]


def without_perks(pairs, what):
    """The recipe with every OR group that holds a HasPerk condition taken
    out (perk_drops), and the CIS1 and CIS2 that follow each of those
    conditions, and nothing else."""
    at = set(perk_drops(pairs))
    if not at:
        raise SystemExit('STOP. %s tests no perk. Nothing was written.' % what)
    out, drop = [], False
    for i, (t, b) in enumerate(pairs):
        if i in at:
            drop = True
            continue
        if drop and t in CTDA_TRAILERS:
            continue
        drop = False
        out.append((t, b))
    return out


def perk_recipes_copied(policy):
    """The never-copied plugins whose recipes that test a perk are copied all
    the same, to take the tests out (perkRecipesCopied on the plugin's
    notCopiedFrom row, #4826), lower case."""
    return frozenset(row['plugin'].lower() for row in policy.get('notCopiedFrom', [])
                     if row.get('perkRecipesCopied') is True)


def perks_kept(src_name, gid, blocked, perks_off):
    """Whether a winning recipe keeps its perk tests: it does when the plugin
    that wins it, or the one that made it, is never copied from and its row
    does not copy its perk recipes."""
    return any(n in blocked and n not in perks_off for n in (src_name.lower(), gid[0]))


def perk_entries(plugins, win, canon, blocked, perks_off=frozenset()):
    """Every winning recipe that tests one of Skyrim's perks (#4826): the
    entries copied here to take the tests out, and what the manifest says of
    them. One a never-copied plugin has or wins keeps its tests and is only
    counted, unless that plugin's row copies its perk recipes (perks_off).
    A perk test joined by OR takes its whole OR group off (perk_drops),
    counted under joinedGroups."""
    here = []
    joined_rows, joined_conditions = 0, 0
    by_plugin, perks, not_copied = collections.Counter(), collections.Counter(), collections.Counter()
    copied_anyway = collections.Counter()
    conditions = 0
    for (tag, gid), e in sorted(win.items()):
        if tag != b'COBJ' or e.flags & DELETED:
            continue
        src = plugins[e.pi]
        pairs = subrecords(src.data(e))
        at, is_joined = perk_tests(pairs)
        if not at:
            continue
        if perks_kept(src.name, gid, blocked, perks_off):
            not_copied[src.name] += 1
            continue
        if is_joined:
            joined_rows += 1
            joined_conditions += len(perk_drops(pairs)) - len(at)
        here.append(e)
        by_plugin[src.name] += 1
        for n in sorted({src.name.lower(), gid[0]} & blocked):
            copied_anyway[canon.get(n, n)] += 1
        conditions += len(at)
        for i in at:
            perks[desc_of(src.gid(struct.unpack_from('<I', pairs[i][1], 12)[0]), canon)] += 1
    stats = {'recipes': len(here), 'conditions': conditions,
             'joinedGroups': {'recipes': joined_rows, 'otherConditions': joined_conditions},
             'byWinner': dict(sorted(by_plugin.items())),
             'tested': dict(sorted(perks.items(), key=lambda kv: (-kv[1], kv[0]))),
             'notCopied': dict(sorted(not_copied.items())),
             'copiedFromNeverCopied': dict(sorted(copied_anyway.items()))}
    return here, stats


def move_entries(table, plugins, win, canon, blocked, carries):
    """The rows recipes.json moved to their trade's bench (#3120), each
    checked against its winning record: (winning entry, the keyword's
    (plugin, object id), row) for every one copied here, and for every one a
    never-copied plugin has or wins, what each person's game is handed
    (RECIPES_MOVED_IN_GAME): its output, the bench it moves from and to, and
    its inputs as the record asks them."""
    here, in_game = [], []
    for desc in sorted(table.get('recipes', {}), key=ref_key):
        row = table['recipes'][desc]
        if not row.get('movedFrom'):
            continue
        row = dict(row, recipe=desc)
        e = win.get((b'COBJ', ref_key(desc)))
        if e is None:
            raise SystemExit('STOP. recipes.json moves %s %s and no plugin has it. Rebuild recipes.json. '
                             'Nothing was written.' % (desc, row['editorId']))
        src = plugins[e.pi]
        pairs = subrecords(src.data(e))
        got = dict(pairs)
        edid = got.get(b'EDID', b'').rstrip(b'\x00').decode('latin1')
        bnam = got.get(b'BNAM')
        put = desc_of(src.gid(struct.unpack_from('<I', bnam, 0)[0]), canon) if bnam else ''
        if edid != row['editorId'] or put.lower() != row['movedFrom'].lower():
            raise SystemExit('STOP. %s in %s is not the recipe recipes.json moved (%s, at %s, and it is %s at %s). '
                             'Rebuild recipes.json. Nothing was written.'
                             % (desc, src.name, row['editorId'], row['movedFrom'], edid, put or 'no bench'))
        kw = ref_key(row['bench'])
        if kw[0] not in canon:
            raise SystemExit('STOP. %s moves to %s, and %s is not in the load order. Nothing was written.'
                             % (desc, row['bench'], row['bench'].split(':', 1)[1]))
        g = src.gid(e.fid)
        if (src.name.lower() in blocked or desc.split(':', 1)[1].lower() in blocked) and not carries(b'COBJ', g):
            in_game.append({'recipe': desc, 'editorId': edid, 'name': row.get('name', ''),
                            'out': desc_of(src.gid(struct.unpack_from('<I', got[b'CNAM'], 0)[0]), canon),
                            'from': row['movedFrom'], 'to': row['bench'],
                            'inputs': [[desc_of(src.gid(struct.unpack_from('<I', b, 0)[0]), canon),
                                        struct.unpack_from('<i', b, 4)[0]] for t, b in pairs if t == b'CNTO']})
        else:
            here.append((e, kw, row))
    return here, in_game


def rebench(pairs, bnam, what):
    """The recipe with its bench keyword (BNAM) set, and nothing else."""
    if [t for t, _ in pairs].count(b'BNAM') != 1:
        raise SystemExit('STOP. %s does not carry exactly one bench keyword. Nothing was written.' % what)
    return [(t, bnam if t == b'BNAM' else b) for t, b in pairs]


def recost_entries(table, plugins, win):
    """(winning entry, row) for every recipe recost.json re-costs, each
    checked to be the record the table measured: its editor id, and its
    inputs, item by item and count by count, in order."""
    out = []
    for row in table.get('recipes', []):
        e = win.get((b'COBJ', ref_key(row['recipe'])))
        if e is None:
            raise SystemExit('STOP. recost.json re-costs %s %s and no plugin has it. Rebuild recipes.json, '
                             'then scripts/dev/Build-Recost.py. Nothing was written.'
                             % (row['recipe'], row['editorId']))
        src = plugins[e.pi]
        pairs = subrecords(src.data(e))
        edid = dict(pairs).get(b'EDID', b'').rstrip(b'\x00').decode('latin1')
        have = [(src.gid(struct.unpack_from('<I', b, 0)[0]), struct.unpack_from('<i', b, 4)[0])
                for t, b in pairs if t == b'CNTO']
        want = [(ref_key(i['item']), i['count']) for i in row['inputs']]
        if edid != row['editorId'] or have != want:
            raise SystemExit('STOP. %s in %s is not the recipe recost.json measured (%s, %d inputs). Rebuild '
                             'recipes.json, then scripts/dev/Build-Recost.py. Nothing was written.'
                             % (row['recipe'], src.name, row['editorId'], len(want)))
        out.append((e, row))
    return out


def recount(pairs, row):
    """The recipe with each input's count set to the table's, in order. An
    input the table takes to 0 is taken out, and COCT says how many are left
    (Patrick, 21 Oct, q-3115 B: a forge recipe charges no gold coins)."""
    to = [i['to'] for i in row['inputs']]
    if not any(to):
        raise SystemExit('STOP. recost.json takes every input out of %s. Nothing was written.' % row['recipe'])
    out, n, coct = [], 0, None
    for t, b in pairs:
        if t == b'CNTO':
            if n >= len(to):
                n += 1
                continue
            keep = to[n]
            n += 1
            if keep == 0:
                continue
            b = b[:4] + struct.pack('<i', keep) + b[8:]
        if t == b'COCT':
            coct = len(out)
        out.append((t, b))
    if n != len(to):
        raise SystemExit('STOP. %s has %d inputs and recost.json %d. Nothing was written.'
                         % (row['recipe'], n, len(to)))
    if coct is None:
        raise SystemExit('STOP. %s has no COCT. Nothing was written.' % row['recipe'])
    out[coct] = (b'COCT', struct.pack('<I', sum(1 for c in to if c)))
    return out


def stop_quest(pairs, what):
    """Start Game Enabled off, and NEVER_TRUE first among the Story Manager
    conditions (the CTDAs after NEXT). First, so it is ANDed with whatever
    group follows: an OR flag on the condition before it cannot reach it."""
    out, done, nexts = [], False, 0
    for t, b in pairs:
        if t == b'DNAM' and not done:
            b = struct.pack('<H', struct.unpack_from('<H', b, 0)[0] & ~START_GAME_ENABLED) + b[2:]
            done = True
        out.append((t, b))
        if t == b'NEXT':
            nexts += 1
            out.append((b'CTDA', NEVER_TRUE))
    if not done or nexts != 1:
        raise SystemExit('STOP. %s does not have one DNAM and one NEXT. Nothing was written.' % what)
    return out


# A script property's type in a VMAD, by the policy's name for it, and the
# status a property set here carries (edited).
PROPERTY_TYPES = {'int': 3, 'float': 4, 'bool': 5}
PROPERTY_EDITED = 1


def property_bytes(prop, what):
    """The policy's value for one script property, as a VMAD holds it."""
    kind, v = prop.get('type'), prop.get('value')
    if kind == 'bool' and isinstance(v, bool):
        return bytes([1 if v else 0])
    if kind == 'int' and isinstance(v, int) and not isinstance(v, bool):
        return struct.pack('<i', v)
    if kind == 'float' and isinstance(v, (int, float)) and not isinstance(v, bool):
        return struct.pack('<f', v)
    raise SystemExit('STOP. the policy sets %s on %s to %r as a %s, which this does not know how to write. '
                     'Nothing was written.' % (prop.get('name'), what, v, kind))


def quest_script(pairs, script, what):
    """The quest's scripts as a tree, and the one named script in it.
    Papyrus names are not case sensitive."""
    vmads = [b for t, b in pairs if t == b'VMAD']
    if len(vmads) != 1:
        raise SystemExit('STOP. %s has no scripts, so it has no %s to set. Nothing was written.' % (what, script))
    tree = vmad_parse(vmads[0], True)
    named = [s for s in tree['scripts'] if s['name'].decode('latin1').lower() == script.lower()]
    if len(named) != 1:
        raise SystemExit('STOP. %s does not carry the script %s once. Nothing was written.' % (what, script))
    return tree, named[0]


def set_properties(pairs, row, what):
    """The quest with the policy row's properties set on its script: a
    property the script carries is changed, one it does not is added. Every
    other byte of the scripts is the winning record's own."""
    tree, script = quest_script(pairs, row['script'], what)
    for prop in row['properties']:
        kind = PROPERTY_TYPES.get(prop.get('type'))
        value = property_bytes(prop, what)
        have = [p for p in script['props'] if p['name'].decode('latin1').lower() == prop['name'].lower()]
        if len(have) > 1:
            raise SystemExit('STOP. %s carries %s more than once. Nothing was written.' % (what, prop['name']))
        if have and have[0]['type'] != kind:
            raise SystemExit('STOP. %s carries %s as type %d, and the policy sets it as a %s. Nothing was written.'
                             % (what, prop['name'], have[0]['type'], prop['type']))
        status = PROPERTY_EDITED if tree['ver'] >= 4 else None
        if have:
            have[0]['value'], have[0]['status'] = value, status
        else:
            script['props'].append({'name': prop['name'].encode('latin1'), 'type': kind,
                                    'status': status, 'value': value})
    body = vmad_write(tree)
    return [(t, body if t == b'VMAD' else b) for t, b in pairs]


def grup(label, gtype, body):
    return b'GRUP' + struct.pack('<I', 24 + len(body)) + label + struct.pack('<iHHI', gtype, 0, 0, 0) + body


def rec(tag, flags, fid, data):
    return tag + struct.pack('<IIIIHH', len(data), flags, fid, 0, FORM_VERSION, 0) + data


def write_plugin(made, masters, plugins, rn):
    """The file: header, then CELL, WRLD and QUST groups in Skyrim's own
    shapes. Everything is sorted by form id, so the same inputs give the same
    bytes."""
    count = 0

    def r(*a):
        nonlocal count
        count += 1
        return rec(*a)

    def g(*a):
        nonlocal count
        count += 1
        return grup(*a)

    # Placed actors under their cells, persistent (8) before temporary (9).
    children = collections.defaultdict(lambda: {8: [], 9: []})
    for tag in ('achr', 'refr'):
        for fid, flags, data, e in made[tag]:
            src = plugins[e.pi]
            children[src.gid(e.ctx[1])][e.ctx[2]].append((fid, e.tag, flags, data))

    def cell_and_children(cg):
        cfid, cflags, cdata, ce = made['cell'][cg]
        body = b''
        for kind in (8, 9):
            items = sorted(children[cg][kind])
            if items:
                body += g(struct.pack('<I', cfid), kind,
                          b''.join(r(t, f, i, d) for i, t, f, d in items))
        # A room copied only to give it a location (#2551) has nothing
        # placed under it here, so it gets no children group.
        if not body:
            return r(b'CELL', cflags, cfid, cdata)
        return r(b'CELL', cflags, cfid, cdata) + g(struct.pack('<I', cfid), 6, body)

    interior = collections.defaultdict(lambda: collections.defaultdict(list))
    exterior = collections.defaultdict(lambda: {'persistent': None,
                                                'blocks': collections.defaultdict(
                                                    lambda: collections.defaultdict(list))})
    for cg, (cfid, cflags, cdata, ce) in made['cell'].items():
        cworld, block, sub, persistent_cell = ce.ctx
        if cworld is None:
            interior[block[1]][sub[1]].append((cfid, cg))
        else:
            wg = plugins[ce.pi].gid(cworld)
            if persistent_cell:
                exterior[wg]['persistent'] = cg
            else:
                exterior[wg]['blocks'][block[1]][sub[1]].append((cfid, cg))

    out = {}
    if interior:
        body = b''
        for blabel in sorted(interior, key=lambda x: struct.unpack('<i', x)[0]):
            sb = b''
            for slabel in sorted(interior[blabel], key=lambda x: struct.unpack('<i', x)[0]):
                sb += g(slabel, 3, b''.join(cell_and_children(cg) for _, cg in sorted(interior[blabel][slabel])))
            body += g(blabel, 2, sb)
        out[b'CELL'] = g(b'CELL', 0, body)
    if made['wrld']:
        body = b''
        for wg, (wfid, wflags, wdata, we) in sorted(made['wrld'].items(), key=lambda x: x[1][0]):
            inner = b''
            if exterior[wg]['persistent'] is not None:
                inner += cell_and_children(exterior[wg]['persistent'])
            blocks = exterior[wg]['blocks']
            for blabel in sorted(blocks, key=lambda x: struct.unpack('<hh', x)[::-1]):
                sb = b''
                for slabel in sorted(blocks[blabel], key=lambda x: struct.unpack('<hh', x)[::-1]):
                    sb += g(slabel, 5, b''.join(cell_and_children(cg) for _, cg in sorted(blocks[blabel][slabel])))
                inner += g(blabel, 4, sb)
            body += r(b'WRLD', wflags, wfid, wdata) + g(struct.pack('<I', wfid), 1, inner)
        out[b'WRLD'] = g(b'WRLD', 0, body)
    if made['qust']:
        out[b'QUST'] = g(b'QUST', 0, b''.join(r(b'QUST', f, i, d) for i, f, d, e in sorted(made['qust'])))
    if made['lctn']:
        out[b'LCTN'] = g(b'LCTN', 0, b''.join(r(b'LCTN', f, i, d)
                                              for i, f, d, e in sorted(made['lctn'], key=lambda x: x[0])))
    if made['cobj']:
        out[b'COBJ'] = g(b'COBJ', 0, b''.join(r(b'COBJ', f, i, d)
                                              for i, f, d, e in sorted(made['cobj'], key=lambda x: x[0])))

    head = [(b'HEDR', struct.pack('<fiI', 1.71, count, 0x800)),
            (b'CNAM', b'Thornswood\x00'),
            (b'SNAM', b'Built by scripts/mods/Build-LastPlugin.py. Loads last. Do not edit.\x00')]
    for m in masters:
        head += [(b'MAST', m.encode('latin1') + b'\x00'), (b'DATA', struct.pack('<Q', 0))]
    hdata = pack_subrecords(head)
    header = b'TES4' + struct.pack('<IIIIHH', len(hdata), LIGHT, 0, 0, FORM_VERSION, 0) + hdata
    return header + b''.join(out[t] for t in GROUP_ORDER if t in out)


# ------------------------------------------------------------ checking

def read_plugin(buf, name, index):
    """A built plugin read with the same walker as the inputs."""
    p = Plugin.__new__(Plugin)
    p.path, p.name, p.index, p.buf = None, name, index, buf
    hs = struct.unpack_from('<I', buf, 4)[0]
    p.hflags = struct.unpack_from('<I', buf, 8)[0]
    p.header_end = 24 + hs
    p.masters = [x.rstrip(b'\x00').decode('latin1') for t, x in subrecords(buf[24:24 + hs]) if t == b'MAST']
    p.localised = False
    p.strings = {}
    return p


def verify(data_dir, plugin_bytes, manifest):
    """The load order with the plugin at its end: no cut actor or floor item
    left able to show, no cut quest left able to start. Returns a list of
    failures."""
    catalogue = json.load(open(CATALOGUE, encoding='utf-8'))
    order, canon, plugins = load(data_dir, catalogue)
    last = read_plugin(plugin_bytes, PLUGIN, len(plugins))
    canon[PLUGIN.lower()] = PLUGIN
    last.masters = [canon.get(m.lower(), m) for m in last.masters]
    if not last.hflags & LIGHT:
        return ['the plugin is not flagged light']
    plugins = plugins + [last]
    win = winners(plugins, {b'ACHR', b'REFR', b'QUST', b'LCTN', b'CELL', b'FLOR', b'COBJ'} | set(FLOOR_TYPES))
    policy = json.load(open(POLICY, encoding='utf-8'))
    blocked = {row['plugin'].lower() for row in policy.get('notCopiedFrom', [])}
    perks_off = perk_recipes_copied(policy)
    fails = []
    # Every re-costed recipe (#613) wins here, asking the counts the manifest says.
    for row in manifest.get('recost', []):
        e = win.get((b'COBJ', ref_key(row['recipe'])))
        pairs = subrecords(plugins[e.pi].data(e)) if e else []
        have = [(plugins[e.pi].gid(struct.unpack_from('<I', b, 0)[0]), struct.unpack_from('<i', b, 4)[0])
                for t, b in pairs if t == b'CNTO'] if e else []
        if e is None or e.pi != last.index or have != [(ref_key(i[0]), i[2]) for i in row['inputs'] if i[2]]:
            fails.append('recipe %s %s does not ask the re-costed counts' % (row['recipe'], row['editorId']))
    # Every recipe moved to its trade's bench (#3120) wins here, at that bench.
    for row in manifest.get('benchMoves', []):
        e = win.get((b'COBJ', ref_key(row['recipe'])))
        bnam = dict(subrecords(plugins[e.pi].data(e))).get(b'BNAM') if e else None
        if e is None or e.pi != last.index or not bnam or \
                plugins[e.pi].gid(struct.unpack_from('<I', bnam, 0)[0]) != ref_key(row['to']):
            fails.append('recipe %s %s is not at %s' % (row['recipe'], row['editorId'], row['to']))
    # No winning recipe tests a perk (#4826), but one a never-copied plugin
    # has or wins whose perk recipes are not copied, which the manifest counts.
    kept = 0
    for (tag, gid), e in win.items():
        if tag != b'COBJ' or e.flags & DELETED:
            continue
        at, _ = perk_tests(subrecords(plugins[e.pi].data(e)))
        if not at:
            continue
        if perks_kept(plugins[e.pi].name, gid, blocked, perks_off):
            kept += 1
        else:
            fails.append('recipe %s still tests a perk' % desc_of(gid, canon))
    if 'perks' in manifest and kept != sum(manifest['perks']['notCopied'].values()):
        fails.append('%d recipes of never-copied plugins test a perk, and the manifest says %d'
                     % (kept, sum(manifest['perks']['notCopied'].values())))
    # Every script property the policy sets (#3101) is on the winning quest,
    # with the policy's value.
    for row in (json.load(open(POLICY, encoding='utf-8')).get('questScriptProperties') or {}).get('quests', []):
        e = win.get((b'QUST', ref_key(row['quest'])))
        what = 'quest %s %s' % (row['quest'], row['edid'])
        if e is None or e.pi != last.index:
            fails.append('%s does not carry the script properties the policy sets' % what)
            continue
        _, script = quest_script(subrecords(plugins[e.pi].data(e)), row['script'], what)
        have = {p['name'].decode('latin1').lower(): p for p in script['props']}
        for prop in row['properties']:
            p = have.get(prop['name'].lower())
            if p is None or p['type'] != PROPERTY_TYPES.get(prop['type']) or \
                    p['value'] != property_bytes(prop, what):
                fails.append('%s does not set %s to %r' % (what, prop['name'], prop['value']))
    for desc in manifest.get('gatesUnlocked', []):
        e = win.get((b'REFR', ref_key(desc)))
        tags = [t for t, _ in subrecords(plugins[e.pi].data(e))] if e else []
        if e is None or e.pi != last.index or b'XLOC' in tags or b'VMAD' in tags:
            fails.append('town gate %s is left locked' % desc)
    # Every place the policy gives a hold is in that hold, by this plugin's
    # own record, read the way scripts/dev/Build-BuildingHolds.py reads it.
    rules = json.load(open(POLICY, encoding='utf-8')).get('placeHolds') or {}
    for row in rules.get('locations', []):
        e = win.get((b'LCTN', ref_key(row['location'])))
        if e is None or e.pi != last.index or form_field(plugins, e, b'PNAM') != ref_key(row['parent']) or                 hold_of(plugins, win, ref_key(row['location'])) != row['holdEdid']:
            fails.append('location %s %s is not in %s by this plugin' % (row['location'], row['edid'], row['holdEdid']))
    for row in rules.get('cells', []):
        e = win.get((b'CELL', ref_key(row['cell'])))
        loc = form_field(plugins, e, b'XLCN') if e is not None else None
        if e is None or e.pi != last.index or loc != ref_key(row['location']) or \
                hold_of(plugins, win, loc) != row['holdEdid']:
            fails.append('room %s %s is not in %s by this plugin' % (row['cell'], row['edid'], row['holdEdid']))
    for desc in manifest['refs']['disabled']:
        e = win.get((b'ACHR', ref_key(desc)))
        tags = [t for t, _ in subrecords(plugins[e.pi].data(e))] if e else []
        if e is None or not e.flags & DISABLED or b'XESP' in tags or b'VMAD' in tags:
            fails.append('cut actor %s is left able to show' % desc)
    off = set(manifest['refs']['disabled']) | set(manifest['refs']['deleted']) | \
        set(manifest['refs']['alreadyOff']) | set(manifest['refs']['corpseKept']) | \
        set(manifest['refs'].get('heldByServer', []))
    for row in catalogue['npcs']:
        if not row['keep'] and row['ref'] != '14:Skyrim.esm' and row['ref'] not in off:
            fails.append('cut actor %s is in no list' % row['ref'])
    kept = {q['quest'] for q in manifest['quests']['kept']}
    mods = {q['quest'] for q in manifest['quests']['modStopped']}
    for (tag, gid), e in win.items():
        if tag != b'QUST':
            continue
        d = desc_of(gid, canon)
        if (gid[0] not in VANILLA and d not in mods) or d in kept:
            continue
        pairs = subrecords(plugins[e.pi].data(e))
        tags = [t for t, _ in pairs]
        dnam = dict(pairs)[b'DNAM']
        after = tags.index(b'NEXT') + 1 if b'NEXT' in tags else None
        if e.pi != last.index or struct.unpack_from('<H', dnam, 0)[0] & START_GAME_ENABLED or \
                after is None or after >= len(pairs) or pairs[after] != (b'CTDA', NEVER_TRUE):
            fails.append('quest %s is left able to start' % d)
    stopped = {q['quest'] for q in manifest['quests']['stopped']} | mods
    for row in manifest['arrivalTalk']:
        if row['quest'] not in stopped and row['quest'] not in kept:
            fails.append('arrival talk %s %s is in no list: decide it in the policy'
                         % (row['quest'], row['edid']))
    # No floor item is left able to show (#3077), and nothing follows one off
    # or on through its enable parent.
    found, parents = floor_scan(plugins, win, floor_bases(plugins, win, canon))
    floor = manifest.get('floorItems') or {}
    # The ones a never-copied plugin places are held off by the server, and
    # nothing else of theirs may be.
    by_server = set(floor.get('heldByServer') or [])
    here = 0
    for g, (e, kind) in found.items():
        tags = [t for t, _ in subrecords(plugins[e.pi].data(e))]
        if e.flags & DELETED:
            continue
        if desc_of(g, canon) in by_server:
            continue
        if e.flags & DISABLED and b'XESP' not in tags and b'VMAD' not in tags:
            here += e.pi == last.index
            continue
        fails.append('floor item %s (a %s) is left able to show' % (desc_of(g, canon), kind))
    if here != floor.get('off'):
        fails.append('%d floor items are off by this plugin, and the manifest says %s' % (here, floor.get('off')))
    mine = {g for g, (e, _) in found.items() if e.pi == last.index}
    # No hold-only plant or ore (#3150) is left able to show outside its hold,
    # and none in its hold is switched off here. The holds are read off the
    # records in the load order with the plugin at its end, so the places it
    # gives a hold count without the policy.
    hold_bases, _ = hold_only_rows(json.load(open(POLICY, encoding='utf-8')))
    hold_scan = {g: HOLD_ONLY + r['produce'] for g, r in hold_bases.items()}
    hold_found, _ = floor_scan(plugins, win, hold_scan)
    hold_place = ref_holds(plugins, win)
    held_off = set((manifest.get('holdOnly') or {}).get('heldByServer') or [])
    hold_here = 0
    for g, (e, kind) in hold_found.items():
        src = plugins[e.pi]
        row = hold_bases[src.gid(struct.unpack('<I', dict(subrecords(src.data(e)))[b'NAME'])[0])]
        tags = [t for t, _ in subrecords(src.data(e))]
        off = bool(e.flags & DELETED) or (e.flags & DISABLED and b'XESP' not in tags and b'VMAD' not in tags)
        if hold_place(e) == row['holdEdid']:
            if e.pi == last.index:
                fails.append('%s %s stands in %s and is switched off here' % (row['name'], desc_of(g, canon),
                                                                                row['holdEdid']))
            continue
        hold_here += e.pi == last.index and off
        if not off and desc_of(g, canon) not in held_off:
            fails.append('%s %s is left able to show outside %s' % (row['name'], desc_of(g, canon), row['holdEdid']))
        if e.pi == last.index:
            mine.add(g)
    if hold_here != len((manifest.get('holdOnly') or {}).get('off') or []):
        fails.append('%d hold-only plants and ores are off by this plugin, and the manifest says %d'
                     % (hold_here, len((manifest.get('holdOnly') or {}).get('off') or [])))
    for g, (e, p) in parents.items():
        if p in mine:
            fails.append('%s has the floor item or hold-only placement %s as its enable parent'
                         % (desc_of(g, canon), desc_of(p, canon)))
    return fails


def same_or_say(path, data, label):
    have = open(path, 'rb').read() if os.path.isfile(path) else None
    if have == data:
        print('  ok    %s is these bytes' % label)
        return True
    print('  DIFFERS  %s is not what this builds' % label)
    return False


def manifest_bytes(manifest):
    return (json.dumps(manifest, indent=1, ensure_ascii=False) + '\n').encode('utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.environ.get('THORNSWOOD_DATA', DATA_DIR))
    ap.add_argument('--check', action='store_true', help='build in memory and compare; write nothing')
    ap.add_argument('--verify', action='store_true', help='check the plugin the committed recipe makes, in the load order')
    ap.add_argument('--tables', default=None,
                    help='the folder of gamemode tables (#5191); game/gamemode-tables when not given')
    ap.add_argument('--out', default='', help='where the plugin is written; Thornswood-Last.esp in --data when not given')
    args = ap.parse_args()
    out = args.out or os.path.join(args.data, PLUGIN)

    if args.verify:
        manifest = json.load(open(MANIFEST, encoding='utf-8'))
        try:
            made = last_recipe.make_from(open(RECIPE, 'rb').read(), [OWN_DIR, args.data])
        except last_recipe.RecipeError as x:
            print('STOP. %s could not be made from game/data/%s out of %s: %s.'
                  % (PLUGIN, os.path.basename(RECIPE), args.data, x))
            return 1
        fails = verify(args.data, made, manifest)
        for f in fails[:40]:
            print('  FAIL  ' + f)
        if fails:
            print('STOP. %d problem(s).' % len(fails))
            return 1
        c = manifest['counts']
        print('  ok    %d cut actors are off and nothing can switch them on; %d vanilla quests '
              'cannot start; %d kept by the policy; %d mod quests cannot start'
              % (c['actorsOff'], c['questsStopped'], c['questsKept'], c['modQuestsStopped']))
        print('  ok    %d locations and %d rooms are in the hold the policy gives them'
              % (c.get('placeLocations', 0), c.get('placeRooms', 0)))
        print('  ok    %d smith recipes ask the counts recost.json gives' % c.get('recipesRecosted', 0))
        print('  ok    %d recipes are at their trade\'s bench (recipes.json, #3120)' % c.get('recipesMoved', 0))
        print('  ok    %d floor items are off and nothing can switch them on' % c.get('floorItemsOff', 0))
        print('  ok    %d hold-only plants and ores are off outside their hold, and none in it'
              % c.get('holdOnlyOff', 0))
        print('  ok    %d mod quests carry the script properties the policy sets'
              % c.get('questScriptProperties', 0))
        return 0

    committed = {m.lower() for m in json.load(open(MANIFEST, encoding='utf-8'))['masters']} \
        if os.path.isfile(MANIFEST) else set()
    plugin, manifest, recipe = build(args.data)
    c = manifest['counts']
    print('Built %s: %s bytes, %d masters' % (PLUGIN, format(len(plugin), ','), len(manifest['masters'])))
    print('  %d cut actors off, in %d cells and %d worldspaces' % (c['actorsOff'], c['cells'], c['worlds']))
    print('  left as they are: %d deleted by a plugin, %d already off, %d authored corpses kept'
          % (len(manifest['refs']['deleted']), len(manifest['refs']['alreadyOff']),
             len(manifest['refs']['corpseKept'])))
    print('  %d vanilla quests stopped, %d kept, %d mod quests stopped'
          % (c['questsStopped'], c['questsKept'], c['modQuestsStopped']))
    for row in manifest['placeHolds']['locations']:
        print('  %s (%s): parent %s -> %s, in %s' % (row['place'], row['edid'], row['parentWas'] or 'none',
                                                    row['parent'], row['hold']))
    for row in manifest['placeHolds']['rooms']:
        print('  %s (%s): no location -> %s, in %s' % (row['place'], row['edid'], row['location'], row['hold']))
    print('  %d smith recipes re-costed (recost.json, #613)' % c['recipesRecosted'])
    print('  %d recipes moved to their trade\'s bench here, %d in each person\'s game (recipes.json, #3120)'
          % (c['recipesMoved'], c['recipesMovedInGame']))
    for row in manifest['questScriptProperties']:
        print('  %s (%s, from %s): %s' % (row['quest'], row['edid'], row['winner'],
                                         ', '.join('%s %s' % (k, json.dumps(v)) for k, v in row['set'].items())))
    for row in manifest['notCopiedFrom']['takenFromBelow']:
        print('  never copied from: %s' % row)
    for row in manifest['notCopiedFrom']['carried']:
        print('  carried from a never-copied plugin (the policy allows it): %s' % row)
    fl = manifest['floorItems']
    print('  %d floor items off (%s); left as they are: %d deleted by a plugin, %d already off'
          % (fl['off'], ', '.join('%d %s' % (n, k) for k, n in fl['byType'].items()), fl['deleted'], fl['alreadyOff']))
    ho = manifest.get('holdOnly')
    if ho:
        for row in ho['resources']:
            print('  hold-only %s %s in %s: %d stay, %d outside it' % (row['kind'], row['name'], row['hold'],
                                                                      row['kept'], row['outside']))
        print('  %d hold-only plants and ores off; left as they are: %d deleted by a plugin, %d already off; '
              '%d held off by the server; %d cells copied only for them'
              % (len(ho['off']), len(ho['deleted']), len(ho['alreadyOff']), len(ho['heldByServer']), ho['cellsAdded']))
    print('  %d cells copied only for the floor items, by the plugin that wins each:' % fl['cellsAdded'])
    for name, n in sorted(fl['cellsAddedByWinner'].items(), key=lambda x: -x[1]):
        print('    %6d  %s%s' % (n, name, '' if name.lower() in committed else
                                  '   (not a master of the committed plugin)'))
    fails = verify(args.data, plugin, manifest)
    if fails:
        for f in fails[:40]:
            print('  FAIL  ' + f)
        print('STOP. what this built does not verify. Nothing was written.')
        return 1
    print('  ok    read back in the load order: every cut actor off, every cut quest unable to start, '
          'every place in the hold the policy gives it, no floor item able to show')
    r = manifest['recipe']
    print('  ok    the recipe makes it back byte for byte from %d plugins and string tables: %s bytes, '
          '%s of them Thornswood\'s own (%s inside records)'
          % (r['sources'], format(r['size'], ','), format(r['ownBytes'], ','), format(r['ownBytesInRecords'], ',')))
    if args.check:
        a = same_or_say(RECIPE, recipe, 'game/data/' + os.path.basename(RECIPE))
        # The manifest is compared as what it says, not as bytes.
        have = json.load(open(MANIFEST, encoding='utf-8')) if os.path.isfile(MANIFEST) else None
        b = have == json.loads(manifest_bytes(manifest).decode('utf-8'))
        print('  %s game/data/last-plugin.json %s' % (('ok   ', 'says what this builds') if b else
                                                       ('DIFFERS', 'is not what this builds')))
        c = gamemode_tables.is_current('HELD_BY_SERVER', held_table(manifest), args.tables)
        print('  %s the HELD_BY_SERVER table %s' % (('ok   ', 'is what this builds') if c else
                                                          ('DIFFERS', 'is not what this builds')))
        d = gamemode_tables.is_current('RECIPES_MOVED_IN_GAME', moved_table(manifest), args.tables)
        print('  %s the RECIPES_MOVED_IN_GAME table %s' % (('ok   ', 'is what this builds') if d else
                                                                 ('DIFFERS', 'is not what this builds')))
        return 0 if a and b and c and d else 1
    with open(out + '.making', 'wb') as f:
        f.write(plugin)
    os.replace(out + '.making', out)
    with open(RECIPE, 'wb') as f:
        f.write(recipe)
    with open(MANIFEST, 'wb') as f:
        f.write(manifest_bytes(manifest))
    gamemode_tables.write('HELD_BY_SERVER', held_table(manifest), args.tables)
    gamemode_tables.write('RECIPES_MOVED_IN_GAME', moved_table(manifest), args.tables)
    print('Wrote %s, game/data/%s, game/data/last-plugin.json, the HELD_BY_SERVER table (%d) and the '
          'RECIPES_MOVED_IN_GAME table (%d)'
          % (out, os.path.basename(RECIPE), len(manifest['floorItems']['heldByServer']) + len(manifest['refs']['heldByServer']) +
             len((manifest.get('holdOnly') or {}).get('heldByServer', [])), len(manifest['benchMovesInGame'])))
    return 0


def held_table(manifest):
    """The HELD_BY_SERVER table, as JSON text: the floor items, cut actors and
    hold-only plants and ores Thornswood-Last.esp cannot switch off without
    copying a plugin it never copies from, which the server holds off instead
    (#3077, #2454, #3150). game/data/last-plugin.json says the same in
    floorItems.heldByServer, refs.heldByServer and holdOnly.heldByServer."""
    return json.dumps(sorted(manifest['floorItems']['heldByServer'] +
                             manifest['refs']['heldByServer'] +
                             (manifest.get('holdOnly') or {}).get('heldByServer', [])))


def moved_table(manifest):
    """The RECIPES_MOVED_IN_GAME table, as JSON text: the recipes moved to
    their trade's bench (#3120) that Thornswood-Last.esp cannot carry without
    copying a plugin it never copies from, which each person's game moves
    instead: the bench keyword each moves from and to, and its inputs as
    [item, count] as the record asks them."""
    rows = {r['recipe']: {'name': r['name'], 'out': r['out'], 'from': r['from'], 'to': r['to'],
                          'inputs': r['inputs']} for r in manifest['benchMovesInGame']}
    return json.dumps(rows, sort_keys=True, ensure_ascii=False)


if __name__ == '__main__':
    sys.exit(main())
