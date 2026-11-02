"""
Measure-MineBuildings.py

Lists every building that holds a placed ore vein, and every building a lock
would shut a vein behind.

WHY

Entry 325 on the To Do List. Two of Patrick's rulings meet at a mine and nobody
has put them side by side yet:

  17 September, the mining design agreed in Discord: "Nobody owns a mine."
  21 September, the property system: "every building in the game is
  claimable, shops and halls and palaces included, so people can lock doors
  and own shops."

Today the second one wins without anybody having chosen it: /claim takes any
building BUILDING_BY_DOOR knows, and a claimed building can be locked. Which of
the two holds is his to say, and this script says nothing about it. What he
needs in front of him to say it is which buildings are actually mines, and a
name is not that. Miner's Barracks has "Mine" in it and no vein, and a cave
called something else can be full of iron. So this answers it from the
plugins, the way the door table was built.

WHAT A MINE IS HERE. A building holding at least one placed reference whose
base is in ORES_BY_BASE. That table is exactly what mineOre lets a person work,
so this counts what the server mines and nothing the server does not.

ON THE WAY IN. A lock keeps people out of a building, and a mine whose veins
are two rooms down is shut just as well by a lock on the first room. So for
every building with a vein, and every worldspace with one behind a building,
this also names the buildings that every road from open ground to it goes
through. The roads come from game\\data\\doors.json, the table BUILDING_BY_DOOR was
generated from, so a building here is the same building /claim would take.

WHAT OPEN GROUND IS. Tamriel and Solstheim, unless --open names others.
Solstheim is on it because the way there is a boat, not a door. Every other
worldspace is one place of its own, because a person walks between its outdoor
cells without a door, and it is measured the way a room is: a worldspace whose
every road in goes through one building is behind that building, as a room two
doors down is. One with a road in that no single building sits on, like
Blackreach and its lifts, is open ground as far as a lock goes. So is one that
no door road joins to Tamriel or Solstheim at all, because people get there by
a spell, a book or a boat and no lock stands on that way; a room reached from
it is measured from it.

The first version counted every outdoor cell in every worldspace as open
ground, and a reviewer measured what that missed on 24 September: Deepwood
Redoubt is the only road into Deepwood Vale and was not listed, Darkfall Cave
is the only road into the Forgotten Vale's 50 veins and was listed as shutting
2, and Frostmere Crypt is the only road into Frostmere Depths.

WHAT IT READS. The plugins in load order, the five masters and then
plugins.txt, last one wins, which is the rule Build-DoorTable.py uses and whose
plugin reader this borrows rather than copies. The gamemode's ORES_BY_BASE,
BUILDING_BY_DOOR and BUILDING_NAME tables (game\\gamemode-tables, #5191).
game\\data\\doors.json.

WHAT IT WRITES. Nothing, unless --out names a file, and then that one file. It
changes no rule and touches neither the gamemode nor the claim.

Usage:
    python scripts/dev/Measure-MineBuildings.py
    python scripts/dev/Measure-MineBuildings.py --out game/data/mine-buildings.json
"""

import argparse
import importlib.util
import io
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# Build-DoorTable.py already reads a plugin: the header, the master list, a form
# id as <hex>:<plugin>, compressed records, localised names. A second copy of
# that here would be a second place for it to be wrong. Its name has a hyphen
# in it, so it is loaded by path rather than imported.
_spec = importlib.util.spec_from_file_location('door_table', os.path.join(HERE, 'Build-DoorTable.py'))
dt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dt)

import own_plugins  # noqa: E402
import gamemode_tables  # noqa: E402  (the gamemode's tables, #5191)

# Record flags. A deleted reference is gone from the world. An initially
# disabled one is placed but not there until something enables it, so it is
# counted and said, rather than hidden or passed off as a vein anybody can see.
DELETED = 0x20
DISABLED = 0x800

MINE_WORD = re.compile(r'\bMines?\b')


def walk(pl, ores, cells, worlds, veins, removed):
    """Every CELL, every WRLD's editor id and name, and every placed ore vein."""
    buf = pl.buf
    u32 = lambda i: struct.unpack_from('<I', buf, i)[0]

    def eat(start, end, cell, world):
        p = start
        while p + 24 <= end:
            tag = buf[p:p + 4]
            size = u32(p + 4)
            if tag == b'GRUP':
                gtype = u32(p + 12)
                kcell, kworld = cell, world
                # Type 1 is a worldspace's children and its label is the
                # worldspace. Type 6 is a cell's children and its label is the
                # cell.
                if gtype == 1:
                    kworld = pl.desc(u32(p + 8))
                elif gtype == 6:
                    kcell = pl.desc(u32(p + 8))
                eat(p + 24, p + size, kcell, kworld)
                p += size
                continue
            flags, fid = struct.unpack_from('<II', buf, p + 8)
            if tag == b'WRLD':
                d = pl.desc(fid)
                if d:
                    # The editor id is what --open matches and what openGround
                    # is keyed by. The name is what a person reads, "Forgotten
                    # Vale" rather than DLC01FalmerValley.
                    row = {'edid': '', 'name': ''}
                    for st, body in dt.subrecords(pl.data(p, size, flags)):
                        if st == b'EDID':
                            row['edid'] = body.rstrip(bytes([0])).decode('ascii', 'replace')
                        elif st == b'FULL':
                            row['name'] = pl.text(body)
                            break
                    worlds[d] = row
            elif tag == b'CELL':
                d = pl.desc(fid)
                if d:
                    name, full, interior = '', '', False
                    for st, body in dt.subrecords(pl.data(p, size, flags)):
                        if st == b'EDID':
                            name = body.rstrip(bytes([0])).decode('ascii', 'replace')
                        elif st == b'FULL':
                            full = pl.text(body)
                        elif st == b'DATA' and len(body) >= 1:
                            interior = bool(body[0] & dt.CELL_INTERIOR)
                    row = {'edid': name, 'interior': interior}
                    if full:
                        row['name'] = full
                    if world and not interior:
                        row['world'] = world
                    cells[d] = row
            elif tag == b'REFR' and cell:
                d = pl.desc(fid)
                if d:
                    base = None
                    if not (flags & DELETED):
                        for st, body in dt.subrecords(pl.data(p, size, flags)):
                            if st == b'NAME' and len(body) >= 4:
                                base = pl.desc(struct.unpack_from('<I', body, 0)[0])
                                break
                    if base in ores:
                        veins[d] = {'base': base, 'cell': cell,
                                    'disabled': bool(flags & DISABLED)}
                        removed.discard(d)
                    elif d in veins:
                        # A later plugin deleted this vein or made it something
                        # else, and the last plugin is the one the game believes.
                        del veins[d]
                        removed.add(d)
            p += 24 + size

    p = 24 + pl.header
    while p + 24 <= len(buf):
        size = struct.unpack_from('<I', buf, p + 4)[0]
        if buf[p:p + 4] != b'GRUP':
            break
        if buf[p + 8:p + 12] in (b'CELL', b'WRLD'):
            eat(p + 24, p + size, None, None)
        p += size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=r'C:\Thornswood\Game\Data')
    ap.add_argument('--plugins', default=r'C:\Thornswood\Profile\Default\plugins.txt')
    ap.add_argument('--tables', default=None,
                    help='the folder of gamemode tables (#5191); game/gamemode-tables when not given')
    ap.add_argument('--doors', default=os.path.join(HERE, '..', '..', 'game', 'data', 'doors.json'))
    ap.add_argument('--out', default=None, help='write the measurement as JSON to this file')
    ap.add_argument('--open', default='Tamriel,DLC2SolstheimWorld',
                    help='editor ids of the worldspaces that are open ground, comma separated')
    args = ap.parse_args()
    open_worlds = set(w.strip() for w in args.open.split(',') if w.strip())

    def table(name):
        f = gamemode_tables.table_file(name, args.tables)
        return gamemode_tables.read(name, args.tables) if os.path.isfile(f) else None
    ores = table('ORES_BY_BASE')
    by_door = table('BUILDING_BY_DOOR')
    names = table('BUILDING_NAME')
    # A table that is not there would make every answer below "no mines", which
    # reads exactly like a world with no mines in it. So it stops instead.
    for label, t in (('ORES_BY_BASE', ores), ('BUILDING_BY_DOOR', by_door),
                     ('BUILDING_NAME', names)):
        if not t:
            print('STOP. the %s table is not in %s, so there is nothing to measure against.'
                  % (label, args.tables or gamemode_tables.DIR))
            return 1
    doors = json.load(io.open(args.doors, encoding='utf-8'))
    claimable = set(by_door.values())

    order = own_plugins.load_order(args.plugins)
    missing = [n for n in order if not os.path.isfile(own_plugins.plugin_path(args.data, n))]
    if missing:
        print('STOP. %d plugin(s) are not in %s: %s'
              % (len(missing), args.data, ', '.join(missing[:6])))
        return 1

    print('The load order')
    print('  %d plugins, the five masters then %s' % (len(order), args.plugins))

    cells, worlds, veins, removed = {}, {}, {}, set()
    failed = 0
    for name in order:
        pl = dt.Plugin(own_plugins.plugin_path(args.data, name), name)
        if not pl.ok:
            continue
        # Only a vein's cell needs a name a person would know, and only when the
        # gamemode's BUILDING_NAME does not already have one. The string tables
        # are still read up front, because which cells hold veins is not known
        # until the walk is over.
        if pl.localised:
            pl.strings = dt.bsa.load_strings(args.data, name)
        walk(pl, ores, cells, worlds, veins, removed)
        failed += pl.failed

    def world_name(w):
        row = worlds.get(w, {})
        return row.get('name') or row.get('edid') or w

    def called(c):
        if c in names:
            return names[c]
        if c in worlds:
            return '%s (worldspace)' % world_name(c)
        row = cells.get(c, {})
        return row.get('name') or row.get('edid') or c

    def interior(c):
        # A cell nothing read is taken as open ground, the same call
        # Build-DoorTable.py makes, so an unknown cell never makes a building
        # look like the only road in.
        row = cells.get(c) or doors['cells'].get(c)
        return bool(row and row.get('interior'))

    # The places the roads join. An interior is a place of its own. An outdoor
    # cell is its worldspace, keyed by the worldspace's form id, or open ground
    # when that worldspace is one of --open. An outdoor cell with no worldspace
    # this read is open ground, for the same reason an unknown cell is.
    OPEN = 'open ground'

    def place(c):
        if interior(c):
            return c
        w = cells.get(c, {}).get('world')
        if not w or worlds.get(w, {}).get('edid') in open_worlds:
            return OPEN
        return w

    in_building, no_door, outdoors, open_ground = {}, {}, {}, {}
    disabled = 0
    for d, v in veins.items():
        c = v['cell']
        if v['disabled']:
            disabled += 1
        where = place(c)
        if where == OPEN:
            w = cells.get(c, {}).get('world')
            w = worlds.get(w, {}).get('edid') or w or 'an unnamed worldspace'
            open_ground[w] = open_ground.get(w, 0) + 1
        elif where != c:
            outdoors.setdefault(where, []).append(v)
        elif c in claimable:
            in_building.setdefault(c, []).append(v)
        else:
            no_door.setdefault(c, []).append(v)

    # The roads, between places rather than cells. Both halves of a door pair
    # name each other, so every link is recorded both ways and it does not
    # matter which half was read first. A door between two outdoor cells of one
    # worldspace joins a place to itself and says nothing about a way in.
    placed = doors['doors']
    links = {}
    for d, r in placed.items():
        other = placed.get(r.get('to'))
        if other:
            a, b = place(r['cell']), place(other['cell'])
            if a != b:
                links.setdefault(a, set()).add(b)
                links.setdefault(b, set()).add(a)

    # A worldspace no door road joins to open ground is reached some other way,
    # a spell, a book or a boat, and no lock stands on that way. So it is open
    # ground too, and a room reached from it is measured from it rather than
    # written off as reached by no door at all.
    joined, todo = set([OPEN]), [OPEN]
    while todo:
        for n in links.get(todo.pop(), ()):
            if n not in joined:
                joined.add(n)
                todo.append(n)
    elsewhere = set(p for p in list(links) + list(outdoors)
                    if p != OPEN and not interior(p) and p not in joined)

    def is_open(p):
        return p == OPEN or p in elsewhere

    def reaches_open(start, without):
        seen, todo = set([start]), [start]
        while todo:
            c = todo.pop()
            if is_open(c):
                return True
            for n in links.get(c, ()):
                if n != without and n not in seen:
                    seen.add(n)
                    todo.append(n)
        return False

    def behind_from(start):
        # Every place reached from start without stepping onto open ground,
        # through rooms and closed worldspaces alike. The buildings among them
        # are the only ones that can be on every road in.
        seen, todo = set([start]), [start]
        while todo:
            c = todo.pop()
            for n in links.get(c, ()):
                if n not in seen and not is_open(n):
                    seen.add(n)
                    todo.append(n)
        return seen

    way_in, shuts, sealed = {}, {}, []
    for v in list(in_building) + list(outdoors):
        if not reaches_open(v, None):
            sealed.append(v)
            continue
        on = [b for b in behind_from(v)
              if b != v and b in claimable and not reaches_open(v, b)]
        way_in[v] = sorted(on, key=called)
        for b in on:
            shuts.setdefault(b, []).append(v)

    # A closed worldspace with a road in that no one building sits on, like
    # Blackreach and its lifts, is open ground as far as a lock goes, and so is
    # one no door road reaches. The rest are behind a building.
    behind = {}
    for w, rows in outdoors.items():
        if way_in.get(w):
            behind[w] = rows
        else:
            k = worlds.get(w, {}).get('edid') or w
            open_ground[k] = open_ground.get(k, 0) + len(rows)

    has_vein = set(in_building) | set(no_door)
    no_vein_mines = {b: n for b, n in names.items()
                     if MINE_WORD.search(n) and b not in has_vein and b not in shuts}

    total = len(veins)
    inside = sum(len(v) for v in in_building.values())
    nowhere = sum(len(v) for v in no_door.values())
    outside = sum(open_ground.values())
    shut_out = sum(len(v) for v in behind.values())

    print('')
    print('Ore veins')
    print('  %d vein base(s) in ORES_BY_BASE' % len(ores))
    print('  %s placed vein reference(s), last plugin wins' % format(total, ','))
    print('  %d of them initially disabled, %d removed by a later plugin'
          % (disabled, len(removed)))
    print('  %s on open ground, where no one lock shuts them: %s' % (format(outside, ','), ', '.join(
        '%s %d' % (w, n) for w, n in sorted(open_ground.items(), key=lambda x: (-x[1], x[0])))))
    print('  %s outdoors in a worldspace whose every road in goes through one building, across %d worldspace(s)'
          % (format(shut_out, ','), len(behind)))
    print('  %s inside a building somebody can /claim, across %d building(s)'
          % (format(inside, ','), len(in_building)))
    print('  %s inside an interior no door leads into, across %d cell(s), so nobody can claim it'
          % (format(nowhere, ','), len(no_door)))
    if failed:
        print('  %d compressed record(s) would not inflate, so this is incomplete' % failed)

    def ore_line(rows):
        count = {}
        for r in rows:
            n = ores[r['base']]['name']
            count[n] = count.get(n, 0) + 1
        return count, ', '.join('%s %d' % (n, k) for n, k in
                                sorted(count.items(), key=lambda x: (-x[1], x[0])))

    print('')
    print('Buildings that hold a vein, which /claim takes and a lock shuts today')
    for b in sorted(in_building, key=called):
        rows = in_building[b]
        _, line = ore_line(rows)
        print('  %-30s %3d  %s' % (called(b), len(rows), line))
        if way_in.get(b):
            print('  %-30s      reached only through %s'
                  % ('', ', '.join(called(x) for x in way_in[b])))

    print('')
    print('Worldspaces holding a vein, where every road in goes through one building')
    if not behind:
        print('  none')
    for w in sorted(behind, key=called):
        rows = behind[w]
        _, line = ore_line(rows)
        print('  %-30s %3d  %s' % (called(w), len(rows), line))
        print('  %-30s      reached only through %s'
              % ('', ', '.join(called(x) for x in way_in[w])))

    # Said by name, because each one is a judgement that no lock stands on the
    # way there, and a door this read missed would make it a wrong one.
    print('')
    print('Worldspaces no door road reaches, so counted as open ground')
    if not elsewhere:
        print('  none')
    for w in sorted(elsewhere, key=called):
        print('  %-30s %3d  %s' % (called(w), len(outdoors.get(w, ())),
                                   worlds.get(w, {}).get('edid') or w))
    if sealed:
        print('')
        print('Buildings holding a vein that no door road joins to any outdoor ground')
        for b in sorted(sealed, key=called):
            print('  %s' % called(b))

    # The ones that hold a vein themselves are in the list above already, with
    # the road written under the building they shut. These are the buildings a
    # rule about mines would miss if it only looked for veins.
    bare = [b for b in shuts if b not in has_vein]
    print('')
    print('Buildings with no vein of their own that a lock would shut a vein behind')
    if not bare:
        print('  none')
    for b in sorted(bare, key=called):
        print('  %-30s shuts %s' % (called(b), ', '.join(called(x) for x in sorted(shuts[b], key=called))))

    # Printed with the cell as well as the name, because an editor's test cell
    # can carry the same name as the real building it was copied from.
    print('')
    print('Interiors holding a vein that no door leads into')
    if not no_door:
        print('  none')
    for c in sorted(no_door, key=called):
        print('  %-30s %3d  %s' % (called(c), len(no_door[c]), c))

    print('')
    print('Buildings called a mine that hold no vein and shut none')
    if not no_vein_mines:
        print('  none')
    for b in sorted(no_vein_mines, key=lambda x: no_vein_mines[x]):
        print('  %s' % no_vein_mines[b])

    if not args.out:
        print('')
        print('  No --out, so nothing was written.')
        return 0

    def building_row(b):
        rows = in_building[b]
        count, _ = ore_line(rows)
        row = {'name': called(b), 'veins': len(rows), 'ores': count,
               'onTheWayIn': way_in.get(b, [])}
        off = sum(1 for r in rows if r['disabled'])
        if off:
            row['disabled'] = off
        if b in sealed:
            row['noDoorRoad'] = True
        return row

    def world_row(w):
        rows = behind[w]
        count, _ = ore_line(rows)
        row = {'name': world_name(w), 'edid': worlds.get(w, {}).get('edid', ''),
               'veins': len(rows), 'ores': count, 'onTheWayIn': way_in[w]}
        off = sum(1 for r in rows if r['disabled'])
        if off:
            row['disabled'] = off
        return row

    payload = {
        'builtBy': 'scripts/dev/Measure-MineBuildings.py',
        'readFrom': own_plugins.load_order_name(order),
        'whatAMineIs': 'a building holding at least one placed reference whose base is in '
                       'ORES_BY_BASE, which is exactly what mineOre lets a person work. A '
                       'building is what BUILDING_BY_DOOR says, the one /claim takes.',
        'whatOpenGroundIs': 'the worldspaces in openWorlds, any other worldspace with a road in '
                            'that no one building sits on, and every worldspace in '
                            'reachedByNoDoor. A worldspace whose every road in goes through '
                            'one building is in worlds, with the buildings on that road.',
        'openWorlds': sorted(open_worlds),
        'reachedByNoDoor': sorted(worlds.get(w, {}).get('edid') or w for w in elsewhere),
        'counts': {'veinBases': len(ores), 'placed': total, 'disabled': disabled,
                   'removedByLaterPlugin': len(removed), 'openGround': outside,
                   'behindABuilding': shut_out, 'worldsBehindABuilding': len(behind),
                   'inBuildings': inside, 'buildings': len(in_building),
                   'noDoor': nowhere, 'failedToInflate': failed},
        'buildings': dict((b, building_row(b)) for b in in_building),
        'worlds': dict((w, world_row(w)) for w in behind),
        'onTheWayIn': dict((b, {'name': called(b), 'shuts': sorted(shuts[b]),
                                'holdsVein': b in has_vein}) for b in shuts),
        'noDoor': dict((c, {'name': called(c), 'veins': len(no_door[c])}) for c in no_door),
        'openGround': open_ground,
        'calledAMineWithNoVein': no_vein_mines,
    }
    io.open(args.out, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(payload, indent=1, sort_keys=True) + '\n')
    print('')
    print('  wrote %s (%s bytes)' % (args.out, format(os.path.getsize(args.out), ',')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
