"""
Build-BuildingHolds.py

Gives every claimable building the hold its doors open onto, measured from the
plugins, and writes it down: game\\data\\building-holds.json and the
gamemode's BUILDING_HOLD table (game\\gamemode-tables, #5191).

WHY (#2551)

Patrick, 16 October, answer C: a Steward evicts and sets rent only in their own
hold, with a table giving every claimable building the hold its door opens
onto. Until this, DATA.cellToHold named a hold for 601 of the 850 buildings
and nothing else knew the rest, so any Steward could evict at any door.

WHERE A HOLD IS IN THE DATA, measured on 17 October over this load order:

  A hold is a location record (LCTN): WhiterunHoldLocation and the other eight,
  and DLC2SolstheimLocation for Raven Rock. A place is in a hold when its own
  location's parent chain (PNAM) reaches that record. That chain is the game's
  own answer to which hold a place is in, and the only one the data holds:

    - No region (REGN) bounds a hold. Skyrim's regions are weather, sound,
      map and navmesh regions (WeatherWhiterun, AudioExtReachCity), none of
      them a hold's edge.
    - An encounter zone (ECZN) names one place's location, a dungeon's or a
      town's, never a hold's ground.
    - Only 1,011 of Tamriel's 11,186 exterior cells carry a location (XLCN),
      the ones in and around a town, a farm or a dungeon. The rest of the
      wilderness is in no hold at all, in the data and so in the game.
    - A location's own list of its exterior cells (LCEC) disagrees with those
      cells' locations in 68 places, so it is not read.

  So a place's hold is read from its location: an exterior cell's own XLCN,
  or its worldspace's when the cell has none (WhiterunWorld is WhiterunLocation
  throughout), and a room's own XLCN.

THE RULE, for each building (an interior a door leads into, Build-DoorTable.py):

  1. The doors that lead into it each stand somewhere: that is the place the
     door opens onto. Every door the game does not place (deleted, or disabled
     from the start) is left out.
  2. The hold of each such place, as above. A room with no location of its
     own is walked through to the places its own doors open onto, the next
     ring out, so a cellar under an inn answers with the inn's hold. A place
     outside with no location is a dead end.
  3. The nearest ring with any hold decides. One hold: that is the building's.
  4. Two or more (a passage between two holds, a back door into Blackreach):
     the building's own location picks between them when it is one of them.
  5. None: the building's own location, when it reaches a hold.
  6. Anything else is refused, with the reason, and the building is left out
     of the table. Nothing is guessed: no nearest town, no lore.

THE CROSS-CHECK. DATA.cellToHold (game\\data\\data.json) is read for every
building it names. Each disagreement has to be written in DISAGREE below with
which answer is right and why, or the build stops.

WHAT IT READS. game\\data\\doors.json for the buildings and their doors (the
same table BUILDING_BY_DOOR and BUILDING_NAME are built from, and the build
stops if the gamemode's buildings are not doors.json's), and the load order of
game\\data\\last-plugin.json then Thornswood-Last.esp, last plugin wins, with the repository's own
plugins from game\\content and Thornswood-Last.esp made in the Data folder from its
recipe (#2791), the way Build-WoodworkingBenches.py reads it. The
game folder has to hold the collection's own bytes
(records\\collection-plugins.json).

WHAT IT WRITES. game\\data\\building-holds.json: every building with its hold,
how it was found and the places it was found at; every building refused and
why; the cross-check; every plugin read with its size and sha256. And
the BUILDING_HOLD table: building to hold, in the town keys the offices use. --check writes nothing and fails when either is not
what the plugins give now.

Usage:
    python scripts/dev/Build-BuildingHolds.py --check
    python scripts/dev/Build-BuildingHolds.py
"""

import argparse
import importlib.util
import io
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# The bench builder's plugin reader and load order: one reader for every
# measurement Thornswood takes out of the plugins.
wb = _module('build_woodworking_benches', os.path.join(HERE, 'Build-WoodworkingBenches.py'))
gamemode_tables = _module('gamemode_tables', os.path.join(HERE, 'gamemode_tables.py'))

DELETED, DISABLED = 0x20, 0x800
CELL_INTERIOR = 0x01
GRID = 4096.0

# Each hold's location record, by editor id, to the town key the offices, the
# boards and the ledgers use (HOLD_TOWN in the gamemode).
TOWN_OF_HOLD = {
    'WhiterunHoldLocation': 'whiterun', 'HaafingarHoldLocation': 'solitude',
    'RiftHoldLocation': 'riften', 'ReachHoldLocation': 'markarth',
    'EastmarchHoldLocation': 'windhelm', 'FalkreathHoldLocation': 'falkreath',
    'HjaalmarchHoldLocation': 'morthal', 'PaleHoldLocation': 'dawnstar',
    'WinterholdHoldLocation': 'winterhold', 'DLC2SolstheimLocation': 'ravenrock',
}

# Where this table and DATA.cellToHold disagree, which is right and why. The
# build stops on a disagreement that is not here, and on one here that no
# longer happens.
DISAGREE = {
}


def desc(k, names):
    return '%x:%s' % (k[1], names.get(k[0], k[0]))


def text(b):
    return b.rstrip(b'\0').decode('latin1')


def read(plugins, want):
    """The winning LCTN, WRLD and CELL records, and the winning placed door
    records named in want (keys), over the load order."""
    lctn, worlds, cells, refs = {}, {}, {}, {}
    for pl in plugins:
        buf = pl.buf
        stack = [(pl.start, len(buf), None, None, None)]
        while stack:
            p, end, world, cell, gtype = stack.pop()
            while p + 24 <= end:
                tag = buf[p:p + 4]
                size = struct.unpack_from('<I', buf, p + 4)[0]
                if tag == b'GRUP':
                    label = struct.unpack_from('<I', buf, p + 8)[0]
                    gt = struct.unpack_from('<i', buf, p + 12)[0]
                    if gt == 0 and buf[p + 8:p + 12] not in (b'LCTN', b'WRLD', b'CELL'):
                        p += size
                        continue
                    w, c = world, cell
                    if gt == 1:
                        w, c = pl.key(label), None
                    elif gt in (6, 8, 9, 10):
                        c = pl.key(label)
                    stack.append((p + 24, p + size, w, c, gt))
                    p += size
                    continue
                flags, fid = struct.unpack_from('<II', buf, p + 8)
                k = pl.key(fid)
                if tag == b'LCTN':
                    row = {'edid': '', 'parent': None}
                    for t, b in wb.subs(pl.body(p, size, flags)):
                        if t == b'EDID':
                            row['edid'] = text(b)
                        elif t == b'PNAM' and len(b) >= 4:
                            row['parent'] = pl.key(struct.unpack_from('<I', b)[0])
                    lctn[k] = None if flags & DELETED else row
                elif tag == b'WRLD':
                    row = {'edid': '', 'loc': None}
                    for t, b in wb.subs(pl.body(p, size, flags)):
                        if t == b'EDID':
                            row['edid'] = text(b)
                        elif t == b'XLCN' and len(b) >= 4:
                            row['loc'] = pl.key(struct.unpack_from('<I', b)[0])
                    worlds[k] = None if flags & DELETED else row
                elif tag == b'CELL':
                    row = {'edid': '', 'world': world, 'grid': None, 'interior': False, 'loc': None,
                           # The world's persistent cell sits straight in the
                           # world's group (type 1), not in a block (type 5),
                           # and stands for no square of ground.
                           'persistent': gtype == 1}
                    for t, b in wb.subs(pl.body(p, size, flags)):
                        if t == b'EDID':
                            row['edid'] = text(b)
                        elif t == b'XCLC' and len(b) >= 8:
                            row['grid'] = struct.unpack_from('<ii', b)
                        elif t == b'DATA' and len(b) >= 1:
                            row['interior'] = bool(b[0] & CELL_INTERIOR)
                        elif t == b'XLCN' and len(b) >= 4:
                            row['loc'] = pl.key(struct.unpack_from('<I', b)[0])
                    cells[k] = None if flags & DELETED else row
                elif tag == b'REFR' and k in want:
                    pos = None
                    for t, b in wb.subs(pl.body(p, size, flags)):
                        if t == b'DATA' and len(b) >= 24:
                            pos = struct.unpack_from('<3f', b)
                    refs[k] = {'cell': cell, 'world': world, 'pos': pos, 'flags': flags, 'by': pl.name}
                p += 24 + size
    return lctn, worlds, cells, refs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.environ.get('THORNSWOOD_DATA') or r'C:\Thornswood\Game\Data')
    ap.add_argument('--doors', default=os.path.join(ROOT, 'game', 'data', 'doors.json'))
    ap.add_argument('--holds', default=os.path.join(ROOT, 'game', 'data', 'data.json'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'game', 'data', 'building-holds.json'))
    ap.add_argument('--tables', default=None,
                    help='the folder of gamemode tables (#5191); game/gamemode-tables when not given')
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    order = wb.load_order(args.data)
    missing = [n for p, n in order if not os.path.isfile(p)]
    if missing:
        print('STOP. %d plugin(s) of the load order are not there: %s' % (len(missing), ', '.join(missing[:6])))
        return 1
    plugins = [wb.Plugin(p, n) for p, n in order]
    record = json.load(io.open(os.path.join(ROOT, 'records', 'collection-plugins.json'), encoding='utf-8'))
    rec = {r['name'].lower(): r for r in record['plugins']}
    other = [pl.name for pl in plugins if pl.name not in wb.OURS + wb.AFTER and
             (pl.name.lower() not in rec or rec[pl.name.lower()]['sha256'].lower() != pl.sha256)]
    if other:
        print('STOP. %d plugin(s) in %s are not the collection\'s bytes (revision %s): %s'
              % (len(other), args.data, record.get('revision'), ', '.join(other[:6])))
        return 2
    names = {pl.name.lower(): pl.name for pl in plugins}
    print('The load order: %d plugins, game\\data\\last-plugin.json\'s then %s; %s read from game\\content'
          % (len(plugins), ' and '.join(wb.AFTER), ', '.join(wb.OURS + wb.AFTER)))

    # ------------------------------------------------ the buildings and doors
    dj = json.load(io.open(args.doors, encoding='utf-8-sig'))
    buildings = dj['buildings']
    name_file = gamemode_tables.table_file('BUILDING_NAME', args.tables)
    served = set(gamemode_tables.read('BUILDING_NAME', args.tables)) if os.path.isfile(name_file) else set()
    if served != set(buildings):
        print('STOP. the gamemode\'s BUILDING_NAME has %d building(s) and doors.json %d, %d apart. '
              'Run scripts\\dev\\Build-DoorTable.py first.'
              % (len(served), len(buildings), len(served ^ set(buildings))))
        return 1

    def key_of(d):
        h, f = d.split(':', 1)
        return (f.lower(), int(h, 16))

    want = set()
    for ds in buildings.values():
        for d in ds:
            want.add(key_of(d))
    lctn, worlds, cells, refs = read(plugins, want)

    gone = sorted(d for ds in buildings.values() for d in ds if key_of(d) not in refs)
    if gone:
        print('STOP. %d door(s) of doors.json are in no plugin of this load order, for example %s. '
              'Run scripts\\dev\\Build-DoorTable.py first.' % (len(gone), ', '.join(gone[:3])))
        return 1

    holds = {}
    for k, v in lctn.items():
        if v and v['edid'] in TOWN_OF_HOLD:
            holds[k] = TOWN_OF_HOLD[v['edid']]
    if sorted(holds.values()) != sorted(TOWN_OF_HOLD.values()):
        print('STOP. the hold locations are not all in this load order: found %s'
              % ', '.join(sorted(lctn[k]['edid'] for k in holds)))
        return 1

    def loc_name(k):
        v = lctn.get(k)
        return v['edid'] if v and v['edid'] else desc(k, names)

    def hold_of_loc(loc):
        """(town, the location's editor id) when the location's parent chain
        reaches a hold, else (None, its editor id)."""
        seen = set()
        first = loc
        while loc and loc not in seen:
            seen.add(loc)
            if loc in holds:
                return holds[loc], loc_name(first)
            v = lctn.get(loc)
            loc = v['parent'] if v else None
        return None, loc_name(first) if first else None

    ground = {}
    for k, c in cells.items():
        if c and not c['interior'] and not c['persistent'] and c['grid'] is not None and c['world']:
            ground[(c['world'], c['grid'][0], c['grid'][1])] = k

    def place_of(d):
        """Where door d stands: a dict for the place, or None when the game
        does not place it."""
        r = refs[key_of(d)]
        if r['flags'] & (DELETED | DISABLED):
            return None
        c = cells.get(r['cell']) if r['cell'] else None
        if c and c['interior']:
            hold, loc = hold_of_loc(c['loc'])
            return {'room': desc(r['cell'], names), 'name': c['edid'] or desc(r['cell'], names),
                    'location': loc, 'hold': hold}
        w = r['world'] or (c['world'] if c else None)
        gx, gy = int(r['pos'][0] // GRID), int(r['pos'][1] // GRID)
        wn = (worlds.get(w) or {}).get('edid') or (desc(w, names) if w else '?')
        g = ground.get((w, gx, gy))
        loc = cells[g]['loc'] if g and cells[g]['loc'] else None
        if not loc:
            loc = (worlds.get(w) or {}).get('loc')
        hold, ln = hold_of_loc(loc)
        return {'name': '%s %d,%d' % (wn, gx, gy), 'location': ln, 'hold': hold}

    def rings(b):
        """The nearest ring of places round b that carries a hold: (ring, the
        places with a hold), or (0, the dead ends) when none does."""
        frontier, seen, dead = [b], {b}, []
        ring = 0
        while frontier:
            ring += 1
            found, nxt = [], []
            for room in frontier:
                for d in buildings.get(room, []):
                    pl = place_of(d)
                    if pl is None:
                        continue
                    # A door that stands in the building itself, or in a room
                    # already walked, opens onto nowhere new.
                    if 'room' in pl and pl['room'] in seen:
                        continue
                    if pl['hold']:
                        found.append(pl)
                    elif 'room' in pl:
                        if pl['room'] not in seen:
                            seen.add(pl['room'])
                            nxt.append(pl['room'])
                    else:
                        dead.append(pl)
            if found:
                return ring, found
            frontier = nxt
        return 0, dead

    def short(pl):
        out = {'place': pl['name']}
        if pl.get('location'):
            out['location'] = pl['location']
        if pl.get('hold'):
            out['hold'] = pl['hold']
        return out

    def uniq(rows):
        out, seen = [], set()
        for r in rows:
            k = json.dumps(r, sort_keys=True)
            if k not in seen:
                seen.add(k)
                out.append(r)
        return sorted(out, key=lambda r: json.dumps(r, sort_keys=True))

    table, refused = {}, {}
    unplaced = 0
    for bld in sorted(buildings):
        c = cells.get(key_of(bld)) or {}
        own, own_loc = hold_of_loc(c.get('loc'))
        name = (dj['cells'].get(bld) or {}).get('name') or c.get('edid') or bld
        for d in buildings[bld]:
            if place_of(d) is None:
                unplaced += 1
        ring, places = rings(bld)
        found = sorted(set(p['hold'] for p in places if p.get('hold')))
        row = {'name': name, 'opensOnto': uniq(short(p) for p in places)}
        if own_loc:
            row['ownLocation'] = own_loc
        if ring > 1:
            row['ring'] = ring
        if len(found) == 1:
            row['hold'], row['how'] = found[0], 'doors'
        elif len(found) > 1 and own in found:
            row['hold'], row['how'] = own, 'doors open onto %s; its own location picks' % ' and '.join(found)
        elif not found and own:
            row['hold'], row['how'] = own, 'own location'
        if 'hold' in row:
            # The doors and the building's own location name two holds: the
            # doors win (Patrick's rule), and the table says so.
            if own and own != row['hold']:
                row['ownLocationHold'] = own
            table[bld] = row
            continue
        if found:
            why = ('its doors open onto %s, and its own location %s none of them'
                   % (' and '.join(found), ('(%s) is' % own_loc) if own_loc else 'is'))
        else:
            where = ', '.join(sorted(set(p['name'] for p in places))) or 'nowhere the game places a door'
            why = ('its doors open onto %s, which no hold\'s location covers, and %s'
                   % (where, ('its own location, %s, is in no hold' % own_loc) if own_loc
                       else 'it has no location of its own'))
        row['why'] = why
        refused[bld] = row

    print('')
    print('The buildings: %d in doors.json, the same %d the gamemode serves' % (len(buildings), len(served)))
    hows = {}
    for r in table.values():
        h = 'doors' if r['how'] == 'doors' else ('own location' if r['how'] == 'own location' else 'split')
        hows[h] = hows.get(h, 0) + 1
    print('  %d measured: %d by the places their doors open onto, %d where those were two holds and the '
          'building\'s own location picked, %d by their own location alone'
          % (len(table), hows.get('doors', 0), hows.get('split', 0), hows.get('own location', 0)))
    differ = sorted(bld for bld, r in table.items() if r.get('ownLocationHold'))
    print('  %d where the doors name one hold and the building\'s own location another; the doors decide:'
          % len(differ))
    for bld in differ:
        r = table[bld]
        print('    %-50s %s: doors %s, own location %s (%s)'
              % (bld, r['name'], r['hold'], r['ownLocationHold'], r.get('ownLocation')))
    print('  %d refused, left out of the table' % len(refused))
    for bld, r in sorted(refused.items()):
        print('    %-50s %s: %s' % (bld, r['name'], r['why']))
    print('  %d door(s) of those buildings the game does not place (deleted or disabled), left out' % unplaced)

    # ------------------------------------------------------- the cross-check
    c2h = json.load(io.open(args.holds, encoding='utf-8-sig')).get('cellToHold', {})
    both = [bld for bld in buildings if bld in c2h]
    agree, disagree = 0, {}
    for bld in sorted(both):
        was = TOWN_OF_HOLD.get(c2h[bld])
        now = table.get(bld, {}).get('hold')
        if was == now:
            agree += 1
        else:
            disagree[bld] = {'cellToHold': was, 'table': now}
    print('')
    print('DATA.cellToHold names %d of the buildings: %d agree, %d disagree' % (len(both), agree, len(disagree)))
    fails = []
    for bld, v in sorted(disagree.items()):
        print('  %s %s: cellToHold %s, this %s' % (bld, (table.get(bld) or refused.get(bld))['name'],
                                                   v['cellToHold'], v['table']))
        if bld not in DISAGREE:
            fails.append(bld)
        else:
            v['right'] = DISAGREE[bld]
    stale = sorted(set(DISAGREE) - set(disagree))
    if fails or stale:
        print('')
        if fails:
            print('STOP. %d disagreement(s) have no reason in DISAGREE: %s' % (len(fails), ', '.join(fails)))
        if stale:
            print('STOP. DISAGREE names %d building(s) that agree now: %s' % (len(stale), ', '.join(stale)))
        return 1

    payload = {
        'builtBy': 'scripts/dev/Build-BuildingHolds.py',
        'issue': 2551,
        'readFrom': ('game/data/doors.json for the buildings and their doors; game/data/last-plugin.json loadOrder, '
                     'then %s, last plugin wins; %s from game/content, %s made in the Data folder from its recipe'
                     % (', '.join(wb.AFTER), ', '.join(wb.OURS), ', '.join(wb.AFTER))),
        'rule': ('A place is in a hold when its location (an exterior cell\'s XLCN, or its worldspace\'s when the cell '
                 'has none, or a room\'s XLCN) reaches that hold\'s location record through its parents. A building '
                 'takes the hold of the places its doors open onto (where the doors that lead into it stand); a room '
                 'with no location is walked through to the places its own doors open onto, and the nearest ring with '
                 'a hold decides. Two holds there: the building\'s own location picks, when it is one of them. None: '
                 'the building\'s own location. Otherwise the building is refused and left out.'),
        'holdLocations': {lctn[k]['edid']: {'location': desc(k, names), 'hold': t} for k, t in sorted(holds.items(), key=lambda kv: kv[1])},
        'counts': {'buildings': len(buildings), 'measured': len(table), 'byDoors': hows.get('doors', 0),
                   'byDoorsOwnLocationPicks': hows.get('split', 0), 'byOwnLocation': hows.get('own location', 0),
                   'refused': len(refused), 'doorsNotPlaced': unplaced,
                   'doorsOverOwnLocation': len(differ)},
        'cellToHold': {'named': len(both), 'agree': agree, 'disagree': disagree},
        'buildings': table,
        'refused': refused,
        'builtAgainst': [{'name': pl.name, 'size': pl.size, 'sha256': pl.sha256} for pl in plugins],
    }
    out_text = json.dumps(payload, indent=1, sort_keys=True) + '\n'

    # The gamemode says above its table() line what BUILDING_HOLD holds: each
    # claimable building, to the hold its doors open onto, in the town keys the
    # offices use; a building the plugins give no hold is not in it.
    hold_text = json.dumps({k: v['hold'] for k, v in sorted(table.items())}, sort_keys=True, separators=(',', ':'))

    if args.check:
        old = io.open(args.out, encoding='utf-8').read() if os.path.isfile(args.out) else ''
        bad = []
        if old != out_text:
            bad.append('game/data/building-holds.json')
        if not gamemode_tables.is_current('BUILDING_HOLD', hold_text, args.tables):
            bad.append('the BUILDING_HOLD table')
        print('')
        if bad:
            print('--check: %s differ from what the plugins give now. Run this without --check.' % ' and '.join(bad))
            return 1
        print('--check: building-holds.json and the BUILDING_HOLD table are what the plugins give. Nothing was written.')
        return 0
    io.open(args.out, 'w', encoding='utf-8', newline='\n').write(out_text)
    gamemode_tables.write('BUILDING_HOLD', hold_text, args.tables)
    print('')
    print('wrote %s and the BUILDING_HOLD table, %d building(s)' % (args.out, len(table)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
