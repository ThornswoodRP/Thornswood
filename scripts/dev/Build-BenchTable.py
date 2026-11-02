"""
Build-BenchTable.py

Works out, for every crafting bench in the load order, which furniture in the
world IS that bench and who can make anything at it, and writes both answers
into the gamemode's BENCH_BY_BASE and BENCH_ACCESS tables (game\\gamemode-tables,
#5191).

WHY

Patrick, 21 September: "all of the vanilla tables should not let you open them to
craft so people don't get around our system", and then, asked which of two
readings he meant: "well some benches dont have our recipes though and yes if you
cant yse it you shouldnt be able to open it".

So the rule is one rule and it covers both cases he named. A bench opens if there
is something you can make at it and does not open if there is not. A forge opens
for a smith and not for a farmer. A bench that holds nothing this server lets
anybody make does not open for anyone, which is the case he raised: there are
benches in Skyrim that none of our recipes sit on.

WHY THE SERVER CANNOT ALREADY ANSWER THIS. mp.onActivate is handed the furniture
reference and its BASE. A recipe names its bench by KEYWORD, in its BNAM. Nothing
in the shipped gamemode joins those two, because nothing has ever needed to: the
craft gate runs after a craft, when the recipe is already known. Refusing to OPEN
one has to happen before any recipe exists, from the base alone. That join is the
first block below.

WHAT IT READS. game\\data\\recipes.json, which Build-RecipeTable.ps1 already wrote and
which carries the bench, owner, half and rank of all 3,439 owned rows and the
bench of all 1,679 unowned ones. Then the FURN and ACTI records of every plugin
in the load order, for the keywords those benches are named by. It is Python
rather than PowerShell because Build-RecipeTable takes five minutes to walk this
load order and this takes a few seconds, and because Build-Backdrop.py,
Sync-LoadOrder.py and Audit-ArmorSlots.py are already here.

WHAT IT WRITES, between markers, the way the recipe table is written:

    BENCH_BY_BASE   furniture base descriptor -> the bench keyword it carries.
                    This is the join the server has never had.
    BENCH_ACCESS    bench keyword descriptor -> what can be made there:
                      name    the keyword's editor id, for the log and nothing else
                      rows    every recipe at the bench that reaches the server,
                              by descriptor. The gate opens the bench for
                              somebody craftAnswer allows one of them, so the
                              door and the craft ask the same question.
                      halves  each half that owns anything here, against the LOWEST
                              rank at which they own something. The gate's
                              refusal names them, and it is the door for the two
                              menu stations, which hold no rows.
                      shut    only on a bench in SHUT_BENCHES below: the sentence
                              the gate says instead of opening it, for anybody.
                              Such a bench has no rows and no halves.

No bench opens for everybody (#3080, NO BENCH IS OPEN FOR ITS OWN SAKE below).

A bench with no owned recipes and no unowned ones is not in BENCH_ACCESS at all,
and the gate refuses a base whose bench it cannot find. That is the "some benches
dont have our recipes" case, and refusing is what was asked for.

Read only apart from the two tables it writes.

Usage:
    python scripts/dev/Build-BenchTable.py --check
    python scripts/dev/Build-BenchTable.py
"""

import argparse
import io
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import own_plugins  # noqa: E402
import gamemode_tables  # noqa: E402  (where a table the gamemode reads is written, #5191)

COMPRESSED = 0x00040000
MASTERS = own_plugins.MASTERS
RANKS = ['novice', 'advanced', 'expert', 'master']
# The record types a bench can be. A crafting station is FURN; the grain mill and
# a handful of modded stations are ACTI.
BENCH_TYPES = (b'FURN', b'ACTI')

# STATIONS THAT ARE A PROFESSION'S WORK AND CARRY NO RECIPE AT ALL.
#
# Alchemy and enchanting in Skyrim are MENUS, not recipes. There is no COBJ for a
# potion and none for an enchantment, so neither station appears anywhere in
# recipes.json and a rule built on recipes alone would shut both of them. That
# would close the Alchemist and the Enchanter out of their own trade, which is
# the opposite of what the rule is for.
#
# They also carry no bench keyword, so there is nothing to join them by. What
# they do carry is a workbench type in WBDT, and that is measured rather than
# looked up: walking every FURN in Skyrim.esm on 21 September gives 381 records
# of type 0, which is "not a bench", 12 of type 1, one each of 2 and 7, three of
# type 3 (CraftingEnchantingWorkbench, its tabletop, and DisenchantmentFont01)
# and two of type 5 (CraftingAlchemyWorkbench and its tabletop). So 3 is
# enchanting and 5 is alchemy, with nothing else wearing either number.
#
# Both open at novice for both halves, because a novice alchemist mixing a
# healing potion is doing their trade. Nothing here gates what they may MAKE:
# the server cannot see a potion being mixed at all, which is its own hole and
# its own entry on the list. This only decides whether the door opens.
MENU_STATIONS = {
    3: {'key': 'enchanting', 'name': 'the arcane enchanter',
        'halves': {'bladebinder': 'novice', 'wardweaver': 'novice'}},
    5: {'key': 'alchemy', 'name': 'the alchemy lab',
        'halves': {'blightbrewer': 'novice', 'physicker': 'novice'}},
}

# NO BENCH IS OPEN FOR ITS OWN SAKE (#3080).
#
# Patrick, 21 October, on the report page: "An open bench opens only for
# somebody with at least one recipe there that they may make." And in the
# thread the same evening: "the forge, tanning rack, and loom should be ones
# that SMiths, and Tailors use", "so they should not be opned to anyone", and
# "make sure the forge tanning rack and loom open to the correct people not just
# that for all".
#
# Until then the professions page named five benches open furniture (the
# cookpot, the forge, the tanning rack, the loom and the Aetherium forge) and
# this script opened them for everybody whatever rows they held, so Skyrim's
# crafting menu opened for somebody who could make nothing in it and only the
# pick was refused. There is no such list now. Each bench carries its rows,
# and the gate opens it for somebody craftAnswer allows at least one of them:
# the same answer, row for row, that the craft itself gets and that hides the
# rest of the menu (handRecipesHidden). A race's own gear, a roll's gear and a
# rank are all in that answer, so no door can be wider than the craft.
#
# No bench opens for everybody. Patrick, 21 October, asked whether the smelter
# should close as well: "yes any bench or thing you can craft or do anything
# Proffesion or Trade related", "Proffesion, Sub-Proffesion or class". A row
# nobody owns (the forge's rings, the smelter's ores, the tanning rack's fur
# plate) is made by whoever the bench opens for, and a bench that holds only
# such rows (the Hearthfire building benches) opens for nobody: there is
# nothing anybody can make there that is their trade.


# THE BENCHES NOTHING CAN BE MADE AT, WHOEVER YOU ARE (#1384).
#
# Tempering is cut. A piece is mended with a repair kit (docs/systems/durability.md),
# and the 1809 temper rows are in docs/systems/cut-items.md, held so an event can
# bring one back. Every recipe these two benches carry is a temper: 471 owned rows
# at the sharpening wheel and 1334 at the armour table are all fires: false, and
# the 11 rows nobody owns at the armour table are tempers too. The engine throws
# every recipe at either bench out before a craft (CraftService RecipeItemsMatch,
# isTemper), and the gamemode refuses one that gets through (recipelessCraft).
#
# Until #1384 this script still opened both. The wheel's temper rows counted as
# Edgewright and Woodwright work, and the armour table was open furniture on the
# premise "Tempering never reaches the server", which stopped being true when
# the refusal went in. So Skyrim's crafting menu opened and listed every piece
# you could temper, and only the pick was refused. A bench here is written shut,
# whatever rows it holds: no rows, no
# halves, and the sentence the gate says instead of opening it. It stays in
# BENCH_BY_BASE, because recipelessCraft and TWO_HANDS still name it. The
# sentence is the gamemode's temper refusal, word for word, and
# tests/test-1384-shut-benches.js holds the two equal. Taking a bench out of
# here, with the cut list, is how a temper comes back for an event.
SHUT_SAYS = ('Tempering is not done here. A piece is mended with a repair kit: '
             'with one in your pack, your inventory names the key that mends a piece.')
# The Aetherium forge is shut too (Patrick, 21 October, #3080: "Aetherium forge
# should open to noone"). Its staff, its plate and its crown are not made.
AETHERIUM_SAYS = 'Nobody works the Aetherium forge.'
SHUT_BENCHES = {
    'CraftingSmithingSharpeningWheel': SHUT_SAYS,
    'CraftingSmithingArmorTable': SHUT_SAYS,
    'DLC1LD_CraftingForgeAetherium': AETHERIUM_SAYS,
}


def subrecords(data):
    out, i = [], 0
    while i + 6 <= len(data):
        tag = data[i:i + 4]
        size = struct.unpack_from('<H', data, i + 4)[0]
        if i + 6 + size > len(data):
            break
        out.append((tag, data[i + 6:i + 6 + size]))
        i += 6 + size
    return out


def masters_of(buf):
    """The plugin's master list, in order, out of its TES4 header."""
    size = struct.unpack_from('<I', buf, 4)[0]
    out = []
    for tag, body in subrecords(buf[24:24 + size]):
        if tag == b'MAST':
            out.append(body.rstrip(b'\x00').decode('ascii', 'replace'))
    return out


def scan(path, name, wanted, keywords_out=None):
    """What this plugin says about benches.

    Returns [(base descriptor, bench key)], where a bench key is either a
    keyword descriptor or one of the MENU_STATIONS keys. When keywords_out is
    given, every KYWD in the plugin is added to it as editor id -> descriptor,
    which is how a bench named only on unowned rows is placed.

    A form id's top byte indexes the plugin's OWN master list, and one past the
    end is the plugin itself. Anything else is an ESL's own encoding, which no
    bench keyword in this table uses, so it is passed over rather than guessed
    at: a wrong guess here would claim a piece of furniture is a forge.
    """
    buf = open(path, 'rb').read()
    if len(buf) < 24 or buf[:4] != b'TES4':
        return []
    masters = masters_of(buf)
    header = struct.unpack_from('<I', buf, 4)[0]
    u32 = lambda i: struct.unpack_from('<I', buf, i)[0]
    found = []

    def plugin_of(fid):
        idx = fid >> 24
        if idx < len(masters):
            return masters[idx]
        if idx == len(masters):
            return name
        return None

    def desc(fid):
        p = plugin_of(fid)
        if p is None:
            return None
        return '%x:%s' % (fid & 0x00FFFFFF, p)

    def eat(start, end, kywd):
        p = start
        while p + 24 <= end:
            tag = buf[p:p + 4]
            size = u32(p + 4)
            if tag == b'GRUP':
                eat(p + 24, p + size, kywd)
                p += size
                continue
            flags, fid = struct.unpack_from('<II', buf, p + 8)
            if not (flags & COMPRESSED):
                pairs = subrecords(buf[p + 24:p + 24 + size])
                if kywd:
                    for st, body in pairs:
                        if st == b'EDID' and keywords_out is not None:
                            d = desc(fid)
                            if d:
                                keywords_out[body.rstrip(bytes([0])).decode('ascii', 'replace')] = d
                    p += 24 + size
                    continue
                bd = desc(fid)
                hit = None
                for st, body in pairs:
                    if st == b'KWDA':
                        for i in range(0, len(body) - 3, 4):
                            kd = desc(struct.unpack_from('<I', body, i)[0])
                            if kd in wanted:
                                hit = kd
                    elif st == b'WBDT' and len(body) >= 1 and body[0] in MENU_STATIONS:
                        # A keyword wins over a workbench type, because a bench
                        # with one of our keywords is a bench we have recipes for
                        # and those are the specific answer.
                        if hit is None:
                            hit = MENU_STATIONS[body[0]]['key']
                if hit and bd:
                    found.append((bd, hit))
            p += 24 + size

    p = 24 + header
    while p + 24 <= len(buf):
        size = u32(p + 4)
        if buf[p:p + 4] != b'GRUP':
            break
        label = buf[p + 8:p + 12]
        if label in BENCH_TYPES:
            eat(p + 24, p + size, False)
        elif label == b'KYWD' and keywords_out is not None:
            eat(p + 24, p + size, True)
        p += size
    return found


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=r'C:\Thornswood\Game\Data')
    ap.add_argument('--plugins', default=r'C:\Thornswood\Profile\Default\plugins.txt')
    ap.add_argument('--recipes', default=os.path.join(here, '..', '..', 'game', 'data', 'recipes.json'))
    ap.add_argument('--tables', default=None,
                    help='the folder of gamemode tables (#5191); game/gamemode-tables when not given')
    ap.add_argument('--check', action='store_true', help='say what it found, write nothing')
    args = ap.parse_args()

    table = json.load(io.open(args.recipes, encoding='utf-8'))
    owned, unowned = table['recipes'], table['unowned']

    # ---------------------------------------------------- what each bench holds
    access = {}
    by_name = {}
    for desc, row in owned.items():
        bench, bname = row.get('bench'), row.get('benchName')
        if not bench:
            continue
        by_name[bname] = bench
        a = access.setdefault(bench, {'name': bname, 'halves': {}})
        # A row the engine throws out before a craft (a temper) is nothing
        # anybody makes, so it opens nothing.
        if row.get('fires') is not False:
            a.setdefault('rows', []).append(desc)
        half = str(row.get('half') or '').lower()
        rank = str(row.get('rank') or 'novice').lower()
        if not half or rank not in RANKS:
            continue
        have = a['halves'].get(half)
        if have is None or RANKS.index(rank) < RANKS.index(have):
            a['halves'][half] = rank

    # ------------------------------------------------- the load order, once
    # A switched off line is not part of this build: the game does not load it
    # and the server never sees its records (#1712, own_plugins.load_order).
    order, off = own_plugins.read_plugins_txt(args.plugins)
    off = len(off)
    print('Load order')
    print('  %d plugin(s): the five masters, then %s' % (len(order), args.plugins))
    if off:
        print('  %d line(s) in that list are switched off and were left out' % off)
    print('')

    missing = [n for n in order if not os.path.isfile(own_plugins.plugin_path(args.data, n))]
    if missing:
        print('STOP. %d plugin(s) in the load order are not in %s: %s'
              % (len(missing), args.data, ', '.join(missing[:6])))
        return 1

    # Every keyword in the load order, by editor id. An unowned row names its
    # bench by NAME and not by descriptor, so without this the smelter cannot be
    # placed at all, and the smelter is the one bench BENCH_OWNER deliberately
    # leaves open to everybody.
    keywords = {}
    for name in order:
        scan(own_plugins.plugin_path(args.data, name), name, set(), keywords)

    # A bench that holds only rows nobody owns is still a bench, so it is in
    # the table and its furniture in BENCH_BY_BASE: with no rows and no halves
    # the gate keeps it shut, rather than leaving it to Skyrim (#3080).
    no_desc = set()
    for row in unowned.values():
        bname = row.get('benchName')
        if not bname:
            continue
        bench = by_name.get(bname) or keywords.get(bname)
        if not bench:
            no_desc.add(bname)
            continue
        access.setdefault(bench, {'name': bname, 'halves': {}})

    # The benches nothing can be made at are shut for everybody, last, so no row
    # can open one again (#1384).
    shut_not_here = []
    for bname in sorted(SHUT_BENCHES):
        bench = by_name.get(bname) or keywords.get(bname)
        if not bench:
            shut_not_here.append(bname)
            continue
        access[bench] = {'name': bname, 'halves': {},
                         'shut': SHUT_BENCHES[bname]}

    # And the two stations whose work is a menu rather than a recipe.
    for spec in MENU_STATIONS.values():
        a = access.setdefault(spec['key'], {'name': spec['name'], 'halves': {}})
        for half, rank in spec['halves'].items():
            a['halves'].setdefault(half, rank)

    for a in access.values():
        if 'rows' in a:
            a['rows'].sort()
    print('Benches')
    print('  %d bench(es) hold something somebody can make' % len(access))
    for bench in sorted(access, key=lambda b: access[b]['name']):
        a = access[bench]
        halves = ', '.join('%s %s' % (h, a['halves'][h]) for h in sorted(a['halves']))
        print('    %-32s %-27s %s%s' % (a['name'], bench,
                                        'shut' if a.get('shut') else ('' if a.get('rows') or a['halves'] else 'nobody'),
                                        halves and ' | ' + halves))
    if shut_not_here:
        print('')
        print('  %d shut bench(es) are not in this load order, so there is nothing to shut:'
              % len(shut_not_here))
        for n in shut_not_here:
            print('    %s' % n)
    if no_desc:
        print('')
        print('  %d bench name(s) appear only on unowned rows, so this cannot place them:'
              % len(no_desc))
        for n in sorted(no_desc):
            print('    %s' % n)
        print('  Those benches hold nothing owned, so nothing is lost by leaving them out:')
        print('  a bench that is not in the table does not open, which is what was asked for.')

    # ------------------------------------------------- which furniture is which
    wanted = set(access)
    by_base = {}
    for name in order:
        for base, keyword in scan(own_plugins.plugin_path(args.data, name), name, wanted):
            # Last in the load order wins, because that is the record the game
            # is using, the same rule Build-RecipeTable settles overrides with.
            by_base[base] = keyword

    print('')
    print('Furniture')
    print('  %d plugin(s) read, %d piece(s) of furniture are one of these benches'
          % (len(order), len(by_base)))

    # A bench no furniture carries can never be looked up, because the gate only
    # ever asks about a base that is standing in the world. Most of these are the
    # two hundred odd HearthFires house-building keywords, one per piece of
    # furniture you can order, which BENCH_UNOWNED_PREFIX in Build-RecipeTable
    # already calls house building rather than a trade. Carrying them to the
    # server would be two hundred rows nothing can ever read.
    carried = set(by_base.values())
    dropped = [b for b in access if b not in carried]
    for b in dropped:
        del access[b]
    if dropped:
        print('  %d bench(es) are carried by no furniture in the load order and were left out'
              % len(dropped))
    per = {}
    for base, keyword in by_base.items():
        per[keyword] = per.get(keyword, 0) + 1
    for bench in sorted(per, key=lambda b: -per[b]):
        print('    %-32s %d base(s)' % (access[bench]['name'], per[bench]))
    for bench in sorted(access, key=lambda b: access[b]['name']):
        if bench not in per:
            print('    %-32s NO FURNITURE CARRIES IT, so nothing in the world is this bench'
                  % access[bench]['name'])

    if args.check:
        print('')
        print('  --check, so nothing was written.')
        return 0

    # ------------------------------------------------------------- the tables
    # Each is its own file in game/gamemode-tables (#5191), laid out by
    # gamemode_tables.layout, which writes LF whatever the machine (#3029).
    # The gamemode says above its table() line what each holds: BENCH_BY_BASE
    # is furniture base to the bench keyword it carries, BENCH_ACCESS is bench
    # keyword to who can make anything at it.
    gamemode_tables.write('BENCH_BY_BASE', json.dumps(by_base, sort_keys=True, separators=(',', ':')), args.tables)
    gamemode_tables.write('BENCH_ACCESS', json.dumps(access, sort_keys=True, separators=(',', ':')), args.tables)
    print('')
    print('  wrote %d furniture base(s) and %d bench(es) into the BENCH_BY_BASE and BENCH_ACCESS tables'
          % (len(by_base), len(access)))
    return 0

if __name__ == '__main__':
    sys.exit(main())
