"""
Build-JailTable.py

Finds each hold's jail in the load order and writes down every door inside it,
so a guard of that hold can open and lock the cells.

WHY

Patrick, 11 October, on #502: "jail cells should be usable by guards and
guards should have jail cell access ... only within their own hold". The
server has never known which doors are a jail's. The door table
(Build-DoorTable.py) groups doors by the building they open into, and inside
a jail every cell door belongs to the jail building and is a way out, so a
claim's lock never turns on one.

WHERE A HOLD'S JAIL IS, read from the world rather than a list of names. Each
hold's crime faction (FACT) names its jail marker (JAIL), the spot outside the
jail where a released prisoner is put. The jail is the interior holding the
door whose teleport leads to that marker. Measured on 12 October, that is one
interior for each of the nine holds and Raven Rock: Dragonsreach Dungeon,
Castle Dour Dungeon, Riften Jail, Windhelm Barracks, Cidhna Mine, Falkreath
Jail, Morthal Jail, Dawnstar Jail, The Chill and The Bulwark Jail.

WHICH DOORS. Every door placed in that interior that is not a way in or out
of it (no teleport): the cell doors, and the few other doors between rooms of
the jail. A door with a lock record is marked as one the game ships locked,
which is what the cell is before any guard has turned it.

WHICH HOLD. The crime faction says, by HOLD_OF_FACTION below, in the town keys
the boards and ledgers use. The gamemode's own cellToHold (game/data/data.json)
is read as a cross-check, and a jail it places in another hold stops the run.

WHAT IT READS. Nothing but the plugins: the five masters, then the plugins
plugins.txt marks active (a line starting with *), in load order, last one
wins. Cell names come out of the masters' string tables, the way
Build-DoorTable.py reads them.

WHAT IT WRITES. game\\data\\jails.json, and the five tables the property
block of game\\gamemode.js reads from game\\gamemode-tables (#5191; until then
the JAIL_CELLS block this wrote into gamemode.js): the doors, the jail's name, the doors
the game ships locked, the jail building itself (Patrick, 12 October: only
the Jarl of the hold claims it) and the keys the game made for the cell
doors (the same day: the game's jail keys open nothing, so the world does
not hand one out).

Usage:
    python scripts/dev/Build-JailTable.py --check
    python scripts/dev/Build-JailTable.py
"""

import argparse
import importlib.util
import io
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bsa  # noqa: E402
import gamemode_tables  # noqa: E402
import own_plugins  # noqa: E402

# Build-DoorTable.py already reads a plugin: the header, the master list, a
# form id as <hex>:<plugin>, compressed records, localised names. Its name has
# a hyphen in it, so it is loaded by path rather than imported.
_spec = importlib.util.spec_from_file_location('door_table', os.path.join(HERE, 'Build-DoorTable.py'))
dt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dt)

TRACK_CRIME = 0x40

# A hold's crime faction, by editor id, to the town key the boards, the
# ledgers and the guards use (LEDGER_HOLDS in the gamemode).
HOLD_OF_FACTION = {
    'CrimeFactionWhiterun': 'whiterun',
    'CrimeFactionHaafingar': 'solitude',
    'CrimeFactionRift': 'riften',
    'CrimeFactionReach': 'markarth',
    'CrimeFactionEastmarch': 'windhelm',
    'CrimeFactionFalkreath': 'falkreath',
    'CrimeFactionHjaalmarch': 'morthal',
    'CrimeFactionPale': 'dawnstar',
    'CrimeFactionWinterhold': 'winterhold',
    'DLC2CrimeRavenRockFaction': 'ravenrock',
}
# The gamemode's hold names (DATA.cellToHold) for the cross-check.
TOWN_OF_HOLD = {
    'WhiterunHoldLocation': 'whiterun', 'HaafingarHoldLocation': 'solitude',
    'RiftHoldLocation': 'riften', 'ReachHoldLocation': 'markarth',
    'EastmarchHoldLocation': 'windhelm', 'FalkreathHoldLocation': 'falkreath',
    'HjaalmarchHoldLocation': 'morthal', 'PaleHoldLocation': 'dawnstar',
    'WinterholdHoldLocation': 'winterhold', 'DLC2SolstheimLocation': 'ravenrock',
}


def edid_of(pairs):
    for st, body in pairs:
        if st == b'EDID':
            return body.rstrip(bytes([0])).decode('ascii', 'replace')
    return ''


def read_factions(pl, out):
    """Each FACT record's editor id, flags and jail marker."""
    buf = pl.buf
    u32 = lambda i: struct.unpack_from('<I', buf, i)[0]
    p = 24 + pl.header
    while p + 24 <= len(buf):
        size = u32(p + 4)
        if buf[p:p + 4] != b'GRUP':
            break
        if buf[p + 8:p + 12] == b'FACT':
            q = p + 24
            while q + 24 <= p + size:
                rs = u32(q + 4)
                if buf[q:q + 4] != b'FACT':
                    q += rs if buf[q:q + 4] == b'GRUP' else 24 + rs
                    continue
                flags, fid = struct.unpack_from('<II', buf, q + 8)
                d = pl.desc(fid)
                pairs = dt.subrecords(pl.data(q, rs, flags))
                row = {'edid': edid_of(pairs), 'flags': 0, 'jail': None, 'from': pl.name}
                for st, body in pairs:
                    if st == b'DATA' and len(body) >= 4:
                        row['flags'] = struct.unpack_from('<I', body, 0)[0]
                    elif st == b'JAIL' and len(body) >= 4:
                        row['jail'] = pl.desc(struct.unpack_from('<I', body, 0)[0])
                if d:
                    out[d] = row
                q += 24 + rs
        p += size


def read_world(pl, bases, cells, doors):
    """Every cell's name, and every placed door: its cell, teleport and lock."""
    buf = pl.buf
    u32 = lambda i: struct.unpack_from('<I', buf, i)[0]

    def eat(start, end, cell, top):
        p = start
        while p + 24 <= end:
            tag = buf[p:p + 4]
            size = u32(p + 4)
            if tag == b'GRUP':
                kid = cell
                if u32(p + 12) == 6:
                    kid = pl.desc(u32(p + 8))
                eat(p + 24, p + size, kid, top)
                p += size
                continue
            flags, fid = struct.unpack_from('<II', buf, p + 8)
            if top == b'DOOR' and tag == b'DOOR':
                d = pl.desc(fid)
                if d:
                    bases.add(d)
            elif tag == b'CELL':
                d = pl.desc(fid)
                if d:
                    row = {'edid': '', 'name': '', 'interior': False}
                    for st, body in dt.subrecords(pl.data(p, size, flags)):
                        if st == b'EDID':
                            row['edid'] = body.rstrip(bytes([0])).decode('ascii', 'replace')
                        elif st == b'FULL':
                            row['name'] = pl.text(body)
                        elif st == b'DATA' and len(body) >= 1:
                            row['interior'] = bool(body[0] & dt.CELL_INTERIOR)
                    cells[d] = row
            elif tag == b'REFR' and cell:
                base = tele = lock = None
                for st, body in dt.subrecords(pl.data(p, size, flags)):
                    if st == b'NAME' and len(body) >= 4:
                        base = pl.desc(struct.unpack_from('<I', body, 0)[0])
                    elif st == b'XTEL' and len(body) >= 4:
                        tele = pl.desc(struct.unpack_from('<I', body, 0)[0])
                    elif st == b'XLOC' and len(body) >= 8:
                        # A lock record is the Creation Kit's Locked box: a
                        # door with one starts the game locked. Its flags
                        # byte holds only whether the level follows the
                        # level of whoever opens it (measured 12 October:
                        # 0 or 4 on every jail door).
                        lock = {'level': body[0],
                                'key': pl.desc(struct.unpack_from('<I', body, 4)[0])}
                d = pl.desc(fid)
                if d and base in bases:
                    doors[d] = {'base': base, 'cell': cell, 'to': tele, 'lock': lock}
            p += 24 + size

    p = 24 + pl.header
    while p + 24 <= len(buf):
        size = u32(p + 4)
        if buf[p:p + 4] != b'GRUP':
            break
        label = buf[p + 8:p + 12]
        if label in (b'DOOR', b'CELL', b'WRLD'):
            eat(p + 24, p + size, None, label)
        p += size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=r'C:\Thornswood\Game\Data')
    ap.add_argument('--plugins', default=r'C:\Thornswood\Profile\Default\plugins.txt')
    ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'game', 'data', 'jails.json'))
    ap.add_argument('--tables', default=None, help='the folder of gamemode tables (game/gamemode-tables)')
    ap.add_argument('--holds', default=os.path.join(HERE, '..', '..', 'game', 'data', 'data.json'))
    ap.add_argument('--check', action='store_true', help='say what it found, write nothing')
    args = ap.parse_args()

    order = own_plugins.load_order(args.plugins)
    missing = [n for n in order if not os.path.isfile(own_plugins.plugin_path(args.data, n))]
    if missing:
        print('STOP. %d active plugin(s) are not in %s: %s'
              % (len(missing), args.data, ', '.join(missing[:6])))
        return 1
    print('The load order')
    print('  %d active plugins, the five masters then %s' % (len(order), args.plugins))

    factions, bases, cells, doors = {}, set(), {}, {}
    # Two passes, as the door table does: a plugin can place a door whose base
    # a later plugin adds, so every base is known before a placement is read.
    plugins = []
    for name in order:
        pl = dt.Plugin(own_plugins.plugin_path(args.data, name), name)
        if pl.ok:
            plugins.append(pl)
            read_factions(pl, factions)
            read_world(pl, bases, {}, {})
    for pl in plugins:
        if pl.localised:
            pl.strings = bsa.load_strings(args.data, pl.name)
        read_world(pl, bases, cells, doors)

    cell_to_hold = {}
    try:
        cell_to_hold = json.load(io.open(args.holds, encoding='utf-8-sig')).get('cellToHold', {})
    except (OSError, ValueError):
        cell_to_hold = {}

    jails, by_door, names, shut, buildings, keys = {}, {}, {}, {}, {}, {}
    print('')
    print('Each hold\'s jail, from its crime faction\'s jail marker')
    for fd, f in sorted(factions.items(), key=lambda kv: kv[1]['edid']):
        town = HOLD_OF_FACTION.get(f['edid'])
        if not town:
            continue
        if not (f['flags'] & TRACK_CRIME) or not f['jail']:
            print('  STOP. %s has no jail marker, so %s has no jail' % (f['edid'], town))
            return 1
        inside = [d for d, r in doors.items() if r['to'] == f['jail']]
        jail_cells = sorted(set(doors[d]['cell'] for d in inside
                                if cells.get(doors[d]['cell'], {}).get('interior')))
        if len(jail_cells) != 1:
            print('  STOP. %s\'s jail marker %s is reached from %d interiors: %s'
                  % (f['edid'], f['jail'], len(jail_cells), ', '.join(jail_cells)))
            return 1
        jc = jail_cells[0]
        held = TOWN_OF_HOLD.get(cell_to_hold.get(jc, ''), '')
        if held and held != town:
            print('  STOP. %s is %s\'s jail by its crime faction, and the gamemode places it in %s'
                  % (jc, town, held))
            return 1
        c = cells.get(jc, {})
        name = c.get('name') or c.get('edid') or jc
        in_jail = sorted(d for d, r in doors.items() if r['cell'] == jc and not r['to'])
        locked = [d for d in in_jail if doors[d]['lock']]
        jails[town] = {'faction': fd, 'factionEdid': f['edid'], 'marker': f['jail'], 'cell': jc,
                       'cellEdid': c.get('edid', ''), 'name': name, 'gamemodeHold': held or None,
                       'doors': {d: {'base': doors[d]['base'], 'lock': doors[d]['lock']} for d in in_jail}}
        names[town] = name
        buildings[jc] = town
        for d in in_jail:
            by_door[d] = town
            k = (doors[d]['lock'] or {}).get('key')
            if k:
                keys[k] = town
        for d in locked:
            shut[d] = 1
        print('  %-10s %-22s %-20s %2d door(s), %2d shipped locked%s'
              % (town, name, jc, len(in_jail), len(locked),
                 '' if held else ' (the gamemode has no hold for this cell)'))
    absent = [t for t in HOLD_OF_FACTION.values() if t not in jails]
    if absent:
        print('  STOP. no jail found for %s' % ', '.join(absent))
        return 1
    print('  %d door(s) in all, %d key(s) the game made for them' % (len(by_door), len(keys)))

    if args.check:
        print('')
        print('  --check, so nothing was written.')
        return 0

    payload = {
        'builtBy': 'scripts/dev/Build-JailTable.py',
        'readFrom': own_plugins.load_order_name(order),
        'whatAJailIs': 'the interior holding the door whose teleport leads to the hold crime '
                       'faction\'s jail marker (FACT JAIL). Its doors are every door placed in it '
                       'with no teleport.',
        'jails': jails,
    }
    io.open(args.out, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(payload, indent=1, sort_keys=True) + '\n')
    print('')
    print('  wrote %s' % args.out)

    # What each table means is written over their table() lines in the gamemode.
    for name, value in (('JAIL_DOOR', by_door), ('JAIL_NAME', names), ('JAIL_SHUT', shut),
                        ('JAIL_BUILDING', buildings), ('JAIL_KEY', keys)):
        changed = gamemode_tables.write(name, json.dumps(value, sort_keys=True, separators=(',', ':')), args.tables)
        print('  %s %s' % ('wrote' if changed else 'already current:', gamemode_tables.table_file(name, args.tables)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
