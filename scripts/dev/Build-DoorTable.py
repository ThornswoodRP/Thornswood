"""
Build-DoorTable.py

Walks every placed reference in the load order and writes down every door that
leads somewhere: which cell it stands in, which cell it opens into, which door it
is paired with, whether it is locked and by what key, and who Bethesda says owns
it.

WHY

The property system settled with Patrick on 21 September rests on one thing that
does not exist yet: the server has no idea what a door IS. Claiming happens at a
door, a deed names a building, a key fits a lock, a steward collects rent on a
property. Every one of those sentences needs the same table, and this repo has
never written a pass over placed references at all.

The entry on the To Do List says it in as many words: "The door table: a pass
over placed references giving every door, its building, its cell and the key its
lock wants. Nothing else can be built until this exists."

WHAT A BUILDING IS, and this is the one judgement in here.

A door with a teleport is a door between two cells. A building is the INTERIOR
cell you arrive in. So the building a door belongs to is the cell on the inside
end of it, and two front doors into the same interior are two doors of one
building, which is what makes a house with a back door one claim rather than two.
A door between two interiors, a cellar hatch or an inn's upstairs, belongs to the
interior it leads INTO by the same rule, and the pass records both ends so that
whoever builds the claim can decide how deep a building goes rather than having
that decided for them here.

WHAT IT READS. Nothing but the plugins. The five masters and then plugins.txt,
in load order, last one wins, which is the rule the game itself uses and the one
Build-RecipeTable settles overrides with.

THE PART THAT HAS NOT BEEN DONE HERE BEFORE: placed references live inside
compressed records, and every other scanner in this repo skips those. A
compressed record is a four byte uncompressed length and then a zlib stream, and
zlib is two header bytes and raw deflate after them. Nothing about a door can be
learned without inflating them, so this does, and counts how many it could not.

WHAT IT WRITES. game\\data\\doors.json, and the three tables the server
carries out of it, BUILDING_BY_DOOR, BUILDING_NAME and WAY_OUT, each in
game\\gamemode-tables\\<NAME>.json, which the gamemode reads when it loads
(#5191; until then they were blocks this wrote into gamemode.js).

Read only apart from those files.

Usage:
    python scripts/dev/Build-DoorTable.py --check
    python scripts/dev/Build-DoorTable.py
"""

import argparse
import io
import json
import os
import struct
import sys
import zlib

import bsa
import gamemode_tables
import own_plugins

COMPRESSED = 0x00040000
MASTERS = own_plugins.MASTERS

# A cell is an interior when bit 0 of its DATA flags is set. Everything else is
# a piece of a worldspace.
CELL_INTERIOR = 0x01

# A localised plugin stores FULL as a four byte string id rather than as text,
# and the text lives in a .STRINGS file inside a BSA. The bit is in the TES4
# header's flags. Five of the 101 plugins in this load order are localised and
# they are the five masters, which is where nearly every cell in the game is.
LOCALISED = 0x80


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
    size = struct.unpack_from('<I', buf, 4)[0]
    return [b.rstrip(bytes([0])).decode('ascii', 'replace')
            for t, b in subrecords(buf[24:24 + size]) if t == b'MAST']


class Plugin(object):
    def __init__(self, path, name):
        self.buf = open(path, 'rb').read()
        self.name = name
        self.ok = len(self.buf) >= 24 and self.buf[:4] == b'TES4'
        if not self.ok:
            return
        self.masters = masters_of(self.buf)
        self.header = struct.unpack_from('<I', self.buf, 4)[0]
        self.failed = 0
        self.localised = bool(struct.unpack_from('<I', self.buf, 8)[0] & LOCALISED)
        self.strings = {}

    def text(self, body):
        """A FULL subrecord as words, whichever way this plugin stores it."""
        if self.localised:
            if len(body) < 4:
                return ''
            return self.strings.get(struct.unpack_from('<I', body, 0)[0], '')
        return body.rstrip(bytes([0])).decode('utf-8', 'replace')

    def desc(self, fid):
        """A form id as <hex>:<plugin>, or None when it cannot be placed.

        The top byte indexes this plugin's own master list and one past the end
        is the plugin itself. An ESL's own encoding is neither, and rather than
        guess at it this answers None: a door placed in the wrong cell is worse
        than a door this does not know about, because one is a gap and the other
        is a lie.
        """
        if not fid:
            return None
        idx = fid >> 24
        if idx < len(self.masters):
            return '%x:%s' % (fid & 0x00FFFFFF, self.masters[idx])
        if idx == len(self.masters):
            return '%x:%s' % (fid & 0x00FFFFFF, self.name)
        return None

    def data(self, p, size, flags):
        """A record's data, inflated when it has to be."""
        raw = self.buf[p + 24:p + 24 + size]
        if not (flags & COMPRESSED):
            return raw
        if len(raw) <= 6:
            return b''
        try:
            return zlib.decompress(raw[4:])
        except zlib.error:
            self.failed += 1
            return b''


def walk(pl, doors, out, want_bases):
    """Every DOOR base, then every placed door reference, cell by cell."""
    buf = pl.buf
    u32 = lambda i: struct.unpack_from('<I', buf, i)[0]

    def eat(start, end, cell, top):
        p = start
        while p + 24 <= end:
            tag = buf[p:p + 4]
            size = u32(p + 4)
            if tag == b'GRUP':
                gtype = u32(p + 12)
                kid = cell
                # Group type 6 is a cell's children and its label IS the cell.
                if gtype == 6:
                    kid = pl.desc(u32(p + 8))
                eat(p + 24, p + size, kid, top)
                p += size
                continue
            flags, fid = struct.unpack_from('<II', buf, p + 8)
            if top == b'DOOR' and tag == b'DOOR':
                d = pl.desc(fid)
                if d:
                    doors[d] = True
            elif tag == b'CELL':
                d = pl.desc(fid)
                if d:
                    pairs = subrecords(pl.data(p, size, flags))
                    name, full, interior = '', '', False
                    for st, body in pairs:
                        if st == b'EDID':
                            name = body.rstrip(bytes([0])).decode('ascii', 'replace')
                        elif st == b'FULL':
                            full = pl.text(body)
                        elif st == b'DATA' and len(body) >= 1:
                            interior = bool(body[0] & CELL_INTERIOR)
                    row = {'edid': name, 'interior': interior}
                    if full:
                        row['name'] = full
                    out['cells'][d] = row
            elif tag == b'REFR' and cell:
                pairs = subrecords(pl.data(p, size, flags))
                base = None
                tele = lock = owner = None
                for st, body in pairs:
                    if st == b'NAME' and len(body) >= 4:
                        base = pl.desc(struct.unpack_from('<I', body, 0)[0])
                    elif st == b'XTEL' and len(body) >= 4:
                        tele = pl.desc(struct.unpack_from('<I', body, 0)[0])
                    elif st == b'XLOC' and len(body) >= 8:
                        # level, three unused, then the key. A key of zero is a
                        # lock with no key, which is every lockpick-only door.
                        lock = {'level': body[0],
                                'key': pl.desc(struct.unpack_from('<I', body, 4)[0])}
                    elif st == b'XOWN' and len(body) >= 4:
                        owner = pl.desc(struct.unpack_from('<I', body, 0)[0])
                if base and base in want_bases:
                    d = pl.desc(fid)
                    if d:
                        row = {'base': base, 'cell': cell}
                        if tele:
                            row['to'] = tele
                        if lock:
                            row['lock'] = lock
                        if owner:
                            row['owner'] = owner
                        out['doors'][d] = row
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
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=r'C:\Thornswood\Game\Data')
    ap.add_argument('--plugins', default=r'C:\Thornswood\Profile\Default\plugins.txt')
    ap.add_argument('--out', default=os.path.join(here, '..', '..', 'game', 'data', 'doors.json'))
    ap.add_argument('--tables', default=None, help='the folder of gamemode tables (game/gamemode-tables)')
    ap.add_argument('--check', action='store_true', help='say what it found, write nothing')
    args = ap.parse_args()

    order = own_plugins.load_order(args.plugins)
    missing = [n for n in order if not os.path.isfile(own_plugins.plugin_path(args.data, n))]
    if missing:
        print('STOP. %d plugin(s) are not in %s: %s'
              % (len(missing), args.data, ', '.join(missing[:6])))
        return 1

    print('The load order')
    print('  %d plugins, the five masters then %s' % (len(order), args.plugins))

    # Two passes. The first learns which bases are doors, because a plugin can
    # place a door whose base another plugin adds, and the second reads the
    # placements. Anything else would miss every door placed before its own base
    # is read.
    doors, out = {}, {'cells': {}, 'doors': {}}
    failed = 0
    for name in order:
        pl = Plugin(own_plugins.plugin_path(args.data, name), name)
        if pl.ok:
            walk(pl, doors, out, set())
    print('')
    print('Door bases')
    print('  %d door record(s) across the load order' % len(doors))

    localised = 0
    for name in order:
        pl = Plugin(own_plugins.plugin_path(args.data, name), name)
        if not pl.ok:
            continue
        # A localised plugin's cell names are string ids, and the text is in a
        # BSA. Only the plugins that say they are localised are looked up, so a
        # plugin that stores its names as words costs nothing here.
        if pl.localised:
            pl.strings = bsa.load_strings(args.data, name)
            if pl.strings:
                localised += 1
        walk(pl, doors, out, set(doors))
        failed += pl.failed

    cells, placed = out['cells'], out['doors']
    leads = {d: r for d, r in placed.items() if r.get('to')}
    locked = {d: r for d, r in leads.items() if r.get('lock')}
    keyed = {d: r for d, r in locked.items() if r['lock'].get('key')}
    owned = {d: r for d, r in leads.items() if r.get('owner')}

    print('')
    print('Placed doors')
    print('  %s placed door reference(s)' % format(len(placed), ','))
    print('  %s of them lead somewhere, which is what a building has' % format(len(leads), ','))
    print('  %s of those are locked, %s of the locks want a named key'
          % (format(len(locked), ','), format(len(keyed), ',')))
    print('  %s carry an owner Bethesda set' % format(len(owned), ','))
    if failed:
        print('  %d compressed record(s) would not inflate, so this is incomplete' % failed)

    # A building is the interior a door opens into. Group by that, so the count
    # below is buildings rather than doorways: a house with a back door is one.
    buildings = {}
    for d, r in leads.items():
        far = r['to']
        # The teleport names the door on the other side, and that door's cell is
        # the cell this one opens into. A pair whose other half is missing is
        # counted separately rather than guessed at.
        other = placed.get(far)
        if not other:
            continue
        inside = other['cell']
        c = cells.get(inside)
        if c and c['interior']:
            buildings.setdefault(inside, []).append(d)
    unpaired = sum(1 for r in leads.values() if r['to'] not in placed)

    print('')
    print('Buildings')
    print('  %s interior cell(s) are reached through a door, which is what a claim is'
          % format(len(buildings), ','))
    more = sum(1 for v in buildings.values() if len(v) > 1)
    print('  %s of them have more than one way in, so a claim has to cover every door'
          % format(more, ','))
    print('  %s door(s) name a partner this pass never saw' % format(unpaired, ','))
    print('  %s cell(s) in all, %s of them interiors'
          % (format(len(cells), ','), format(sum(1 for c in cells.values() if c['interior']), ',')))
    named = sum(1 for b in buildings if cells.get(b, {}).get('name'))
    print('  %s of the %s buildings have a name a person would recognise, out of %d string '
          'table(s)' % (format(named, ','), format(len(buildings), ','), localised))
    if named < len(buildings):
        print('  %s have only an editor id, so a deed to one cannot be worded yet'
              % format(len(buildings) - named, ','))
        for b in sorted(buildings):
            if not cells.get(b, {}).get('name'):
                print('    %s' % cells.get(b, {}).get('edid', b))
                break

    if args.check:
        print('')
        print('  --check, so nothing was written.')
        return 0

    # 74,161 cells were read and all but a few hundred are open ground with no
    # door in them. Only the ones a door stands in or opens into are kept, because
    # the rest cannot be looked up by anything this table is for and would be four
    # megabytes of nothing.
    keep = set()
    for r in placed.values():
        keep.add(r['cell'])
        other = placed.get(r.get('to'))
        if other:
            keep.add(other['cell'])
    cells = {k: v for k, v in cells.items() if k in keep}

    payload = {
        'builtBy': 'scripts/dev/Build-DoorTable.py',
        'readFrom': own_plugins.load_order_name(order),
        'whatABuildingIs': 'the interior cell a door opens into. Two front doors into one '
                           'interior are two doors of one building, which is what makes a house '
                           'with a back door a single claim.',
        'counts': {'doorBases': len(doors), 'placed': len(placed), 'lead': len(leads),
                   'locked': len(locked), 'keyed': len(keyed), 'owned': len(owned),
                   'buildings': len(buildings), 'unpaired': unpaired,
                   'failedToInflate': failed},
        'cells': cells,
        'doors': placed,
        'buildings': {k: sorted(v) for k, v in buildings.items()},
    }
    io.open(args.out, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(payload, indent=1, sort_keys=True))
    print('')
    print('  wrote %s (%s bytes)' % (args.out, format(os.path.getsize(args.out), ',')))

    # ------------------------------------------------ what the server carries
    #
    # doors.json is 900KB and most of it is for reading rather than for running.
    # The server needs two questions answered and no more: which building is this
    # door, and what is that building called.
    #
    # WHICH BUILDING A DOOR BELONGS TO. The far side when the far side is an
    # interior, which is the door you walk IN through; otherwise its own cell
    # when that is an interior, which is the same doorway from the inside. Both
    # halves of a front door therefore answer with the house, which is what makes
    # locking work from either side. A cellar hatch answers with the cellar from
    # above and with the house from below, and that is the honest answer for a
    # door between two rooms that are both somebody's.
    by_door, names = {}, {}
    for d, r in placed.items():
        far = placed.get(r.get('to'))
        building = None
        if far and cells.get(far['cell'], {}).get('interior'):
            building = far['cell']
        elif cells.get(r['cell'], {}).get('interior'):
            building = r['cell']
        if building and building in buildings:
            by_door[d] = building
    for b in set(by_door.values()):
        c = cells.get(b, {})
        names[b] = c.get('name') or c.get('edid') or b

    # WHICH DOORS ARE A WAY OUT, because a lock keeps people out and never
    # shuts them in. Both halves of a front door answer with the house, so
    # until this a stranger inside when the holder locked up found every way
    # out locked: measured on 24 September against doors.json, 3,326 of the
    # 4,891 doors above stand inside the building they belong to, in 812 of
    # the 852 buildings.
    #
    # A door is a way out when it stands inside its own building, or when it
    # stands in a room whose only road to open ground is through that
    # building. The second is a cellar: Windstad Manor's, an inn's, the
    # Winking Skeever's lower cellar two rooms down. Somebody down there got
    # in through the house, so letting them back through it lets nobody in who
    # was not already inside. Every door that stands on open ground still
    # locks, which is what keeps people out.
    leaves = {}
    for d, r in placed.items():
        other = placed.get(r.get('to'))
        if other:
            leaves.setdefault(r['cell'], []).append(other['cell'])

    def open_ground_without(start, building):
        # A cell this table never read is taken as open ground, so a door this
        # cannot follow stays a door that locks.
        seen, todo = set([start]), [start]
        while todo:
            c = todo.pop()
            if not cells.get(c, {}).get('interior'):
                return True
            for n in leaves.get(c, []):
                if n != building and n not in seen:
                    seen.add(n)
                    todo.append(n)
        return False

    way_out = {}
    for d, b in by_door.items():
        stands = placed[d]['cell']
        if stands == b or (cells.get(stands, {}).get('interior')
                           and not open_ground_without(stands, b)):
            way_out[d] = 1

    print('')
    print('What the server carries')
    print('  %s door(s) answer with a building, across %s building(s)'
          % (format(len(by_door), ','), format(len(names), ',')))
    print('  %s of those door(s) are a way out, so a lock never turns on them'
          % format(len(way_out), ','))

    # What each table means is written over its table() line in the gamemode.
    for name, value in (('BUILDING_BY_DOOR', by_door), ('BUILDING_NAME', names), ('WAY_OUT', way_out)):
        changed = gamemode_tables.write(name, json.dumps(value, sort_keys=True, separators=(',', ':')), args.tables)
        print('  %s %s' % ('wrote' if changed else 'already current:', gamemode_tables.table_file(name, args.tables)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
