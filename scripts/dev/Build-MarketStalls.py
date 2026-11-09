"""
Build-MarketStalls.py (#3160)

Finds every market stall the game places in a town, out of the plugins, and
writes them down in game\\data\\market-stalls.json. Then
scripts\\dev\\Build-MarketStallsGamemode.js carries the table into the
gamemode and the front plugin.

WHY. Patrick, 22 October 2026, on #3160: "Stalls are fixed market stalls,
claimed like property." So the stalls are the ones already standing in the
towns' markets, nobody puts one up, and which they are is read out of the
game's records, the way the stations and the benches are
(docs\\systems\\station-placement.md).

WHAT A STALL IS, measured on 26 October over this load order (#3160):

  A stall is a placed static whose mesh is one of the market stall counters
  Skyrim ships, STALL_MESHES below, whichever record places it: mods place
  the same counters under their own editor ids (JK's Skyrim's
  XJKMarketStall01 is Riften's RTMarketStall01.nif). A roof, a top, a
  display shelf or a wrecked stand is not a counter, so it is not a stall.

  It is a stall when the game places it: neither deleted nor disabled from
  the start, and, when it has an enable parent, that parent leaves it
  enabled at the start.

  It is a stall in a hold's town when the place it stands in is in a hold
  (the location rule of scripts\\dev\\Build-BuildingHolds.py: an exterior
  cell's XLCN, or its worldspace's, or a room's, reaching a hold through its
  parents), and that location, or one it is inside, is one Skyrim marks as a
  town (TOWN_KEYWORDS), and no location between the stall and the town is a
  house (HOUSE_KEYWORDS). So Solitude's docks count (SolitudeDocksLocation,
  no keyword, inside SolitudeLocation) and Elysium Estate's yard does not
  (LocTypeHouse, inside WhiterunLocation). A stall standing anywhere else,
  at a house or on a road, is refused and listed with why.

  The same counter placed twice at one spot (two plugins each placing it, a
  few units apart) is one stall: references closer than SAME_SPOT units
  across the ground are one stall, and the one the earlier plugin placed is
  kept.

WHERE "AT THE STALL" IS. The point is the middle of the counter's bounds
(the base record's OBND, turned by the reference's angle and scaled by its
scale), on the ground the stall stands on (the bottom of the bounds). The
reach is half the bounds' diagonal across the ground, so anywhere round the
counter, and ARM beyond its edge for somebody standing at it.

WHAT IT WRITES. game\\data\\market-stalls.json: each stall with its id
(<hold>-<the reference's hex>), hold, place (the location's own name, as the
game shows it), world or cell, point and reach, and the reference, base and
plugin it was measured from; every stall refused and why; every plugin read
with its size and sha256. --check writes nothing and fails when the file is
not what the plugins give now.

    python scripts/dev/Build-MarketStalls.py --data <the game's Data>
    python scripts/dev/Build-MarketStalls.py --data <the game's Data> --check
"""

import argparse
import importlib.util
import io
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import bsa  # noqa: E402


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# One plugin reader and one load order for every measurement Thornswood takes.
wb = _module('build_woodworking_benches', os.path.join(HERE, 'Build-WoodworkingBenches.py'))
bh = _module('build_building_holds', os.path.join(HERE, 'Build-BuildingHolds.py'))

DELETED, DISABLED = bh.DELETED, bh.DISABLED
GRID = bh.GRID
LOCALISED = 0x80

# The counters Skyrim ships, by mesh file name: Whiterun's stands, Solitude's,
# Windhelm's, Riften's and Markarth's stalls.
STALL_MESHES = {
    'wrmarketstand01.nif', 'wrmarketstand02.nif', 'wrmarketstand03.nif',
    'smarketstall01.nif', 'smarketstall02.nif', 'smarketstall03.nif',
    'whmarketstall01.nif', 'whmarketstall02.nif',
    'rtmarketstall01.nif', 'rtmarketstall02.nif', 'rtmarketstall03.nif',
    'rtmarketstall04.nif', 'rtmarketstall05.nif',
    'mrkmarketstall01.nif',
}

# The location keywords Skyrim marks a town with: a hold's walled city, a
# town, a settlement.
TOWN_KEYWORDS = {'LocTypeCity', 'LocTypeTown', 'LocTypeSettlement'}

# A place inside a town that is somebody's house and its yard: a stall there
# is the house's, not the market's (Elysium Estate's yard outside Whiterun).
HOUSE_KEYWORDS = {'LocTypeHouse', 'LocTypeDwelling', 'LocTypePlayerHouse'}

# Two references of one counter closer than this across the ground are one
# stall placed twice. Two counters side by side stand a counter's width apart,
# 140 units and more.
SAME_SPOT = 64.0

# Beyond the counter's edge, where somebody at it stands: a body's width and
# an arm.
ARM = 96.0

XESP_OPPOSITE = 0x01


def text(b):
    return b.rstrip(b'\0').decode('latin1')


def is_localised(pl):
    return bool(struct.unpack_from('<I', pl.buf, 8)[0] & LOCALISED)


def read(plugins, data):
    """The bases with a stall mesh, the keywords, the locations' keywords and
    names, and every placed reference of a stall base, last plugin wins."""
    strings = {}
    bases, kywd, locs = {}, {}, {}
    for pl in plugins:
        loc_strings = None

        def visit(tag, p, size, flags, fid, world, cell, pl=pl):
            nonlocal loc_strings
            k = pl.key(fid)
            if tag == b'KYWD':
                kywd[k] = next((text(b) for t, b in wb.subs(pl.body(p, size, flags)) if t == b'EDID'), '')
            elif tag == b'STAT':
                if flags & DELETED:
                    bases.pop(k, None)
                    return
                model, ob, edid = '', None, ''
                for t, b in wb.subs(pl.body(p, size, flags)):
                    if t == b'EDID':
                        edid = text(b)
                    elif t == b'MODL':
                        model = text(b)
                    elif t == b'OBND' and len(b) == 12:
                        ob = struct.unpack_from('<6h', b)
                mesh = model.replace('/', '\\').split('\\')[-1].lower()
                if mesh in STALL_MESHES and ob:
                    bases[k] = {'edid': edid, 'model': model, 'bounds': ob}
                else:
                    bases.pop(k, None)
            elif tag == b'LCTN':
                if flags & DELETED:
                    locs.pop(k, None)
                    return
                row = {'kw': [], 'name': ''}
                for t, b in wb.subs(pl.body(p, size, flags)):
                    if t == b'KWDA':
                        row['kw'] = [pl.key(x) for x in struct.unpack_from('<%dI' % (len(b) // 4), b)]
                    elif t == b'FULL':
                        if is_localised(pl):
                            if loc_strings is None:
                                loc_strings = strings.setdefault(pl.name, bsa.load_strings(data, pl.name))
                            row['name'] = loc_strings.get(struct.unpack_from('<I', b)[0], '') if len(b) >= 4 else ''
                        else:
                            row['name'] = b.rstrip(b'\0').decode('utf-8', 'replace')
                locs[k] = row
        pl.walk(visit, tops={b'KYWD', b'STAT', b'LCTN'})

    refs = {}
    for pl in plugins:
        def visit(tag, p, size, flags, fid, world, cell, pl=pl):
            if tag != b'REFR':
                return
            ss = wb.subs(pl.body(p, size, flags))
            base = next((pl.key(struct.unpack_from('<I', b)[0]) for t, b in ss if t == b'NAME' and len(b) >= 4), None)
            k = pl.key(fid)
            if base not in bases:
                # A later plugin that turns the reference into something else.
                refs.pop(k, None)
                return
            row = {'base': base, 'world': world, 'cell': cell, 'flags': flags, 'by': pl.name,
                   'pos': None, 'scale': 1.0, 'parent': None}
            for t, b in ss:
                if t == b'DATA' and len(b) >= 24:
                    row['pos'] = struct.unpack_from('<6f', b)
                elif t == b'XSCL' and len(b) >= 4:
                    row['scale'] = struct.unpack_from('<f', b)[0]
                elif t == b'XESP' and len(b) >= 5:
                    row['parent'] = (pl.key(struct.unpack_from('<I', b)[0]), bool(b[4] & XESP_OPPOSITE))
            refs[k] = row
        pl.walk(visit, tops={b'WRLD', b'CELL'})
    return bases, kywd, locs, refs


def parents_of(plugins, want):
    """Each wanted reference's flags and its own enable parent, last plugin
    wins, for the enable parents of the stalls and theirs."""
    out = {}
    for pl in plugins:
        def visit(tag, p, size, flags, fid, world, cell, pl=pl):
            if tag not in (b'REFR', b'ACHR'):
                return
            k = pl.key(fid)
            if k not in want:
                return
            parent = None
            for t, b in wb.subs(pl.body(p, size, flags)):
                if t == b'XESP' and len(b) >= 5:
                    parent = (pl.key(struct.unpack_from('<I', b)[0]), bool(b[4] & XESP_OPPOSITE))
            out[k] = {'flags': flags, 'parent': parent}
        pl.walk(visit, tops={b'WRLD', b'CELL'})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.environ.get('THORNSWOOD_DATA') or r'C:\Thornswood\Game\Data')
    ap.add_argument('--out', default=os.path.join(ROOT, 'game', 'data', 'market-stalls.json'))
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    order = wb.load_order(args.data)
    missing = [n for p, n in order if not os.path.isfile(p)]
    if missing:
        print('STOP. %d plugin(s) of the load order are not there: %s' % (len(missing), ', '.join(missing[:6])))
        return 1
    plugins = [wb.Plugin(p, n) for p, n in order]
    stop = wb.collection_stop(plugins, wb.OURS + wb.AFTER, args.data)
    if stop:
        print(stop)
        return 2
    names = {pl.name.lower(): pl.name for pl in plugins}
    rank = {pl.name.lower(): i for i, pl in enumerate(plugins)}
    print('The load order: %d plugins, game\\data\\last-plugin.json\'s then %s; %s read from game\\content'
          % (len(plugins), ' and '.join(wb.AFTER), ', '.join(wb.OURS + wb.AFTER)))

    def desc(k):
        return '%x:%s' % (k[1], names.get(k[0], k[0]))

    bases, kywd, locs, refs = read(plugins, args.data)
    lctn, worlds, cells, _ = bh.read(plugins, set())
    print('')
    print('Stall counters: %d base record(s) with a stall mesh, %d placed reference(s) of them'
          % (len(bases), len(refs)))

    holds = {}
    for k, v in lctn.items():
        if v and v['edid'] in bh.TOWN_OF_HOLD:
            holds[k] = bh.TOWN_OF_HOLD[v['edid']]
    if sorted(holds.values()) != sorted(bh.TOWN_OF_HOLD.values()):
        print('STOP. the hold locations are not all in this load order')
        return 1
    town_kw = set(k for k, e in kywd.items() if e in TOWN_KEYWORDS)
    house_kw = set(k for k, e in kywd.items() if e in HOUSE_KEYWORDS)
    if len(town_kw) != len(TOWN_KEYWORDS) or len(house_kw) != len(HOUSE_KEYWORDS):
        print('STOP. the town and house keywords are not all in this load order: found %s'
              % ', '.join(sorted(kywd[k] for k in town_kw | house_kw)))
        return 1

    def chain(loc):
        out, seen = [], set()
        while loc and loc not in seen:
            seen.add(loc)
            out.append(loc)
            v = lctn.get(loc)
            loc = v['parent'] if v else None
        return out

    ground = {}
    for k, c in cells.items():
        if c and not c['interior'] and not c['persistent'] and c['grid'] is not None and c['world']:
            ground[(c['world'], c['grid'][0], c['grid'][1])] = k

    # The enable parents, and theirs, until none is left to read.
    want, known = set(), {}
    for r in refs.values():
        if r['parent']:
            want.add(r['parent'][0])
    while want - set(known):
        got = parents_of(plugins, want - set(known))
        for k in want - set(known):
            known[k] = got.get(k)
        want = set(v['parent'][0] for v in known.values() if v and v['parent']) | want

    def enabled(flags, parent, depth=0):
        if flags & (DELETED | DISABLED):
            return False
        if not parent or depth > 16:
            return True
        p = known.get(parent[0])
        on = bool(p) and enabled(p['flags'], p['parent'], depth + 1)
        return on != parent[1]

    rows, refused = [], {}
    for k, r in sorted(refs.items(), key=lambda kv: (rank.get(kv[0][0], 999), kv[0][1])):
        b = bases[r['base']]
        why = None
        c = cells.get(r['cell']) if r['cell'] else None
        if not r['pos']:
            why = 'it has no position'
        elif not enabled(r['flags'], r['parent']):
            why = 'the game does not place it at the start (deleted, disabled, or its enable parent leaves it off)'
        if why is None:
            if c and c['interior']:
                loc = c['loc']
                where = desc(r['cell'])
            else:
                w = r['world'] or (c['world'] if c else None)
                g = ground.get((w, int(r['pos'][0] // GRID), int(r['pos'][1] // GRID)))
                loc = cells[g]['loc'] if g and cells[g]['loc'] else None
                if not loc:
                    loc = (worlds.get(w) or {}).get('loc')
                where = desc(w) if w else None
            ch = chain(loc)
            hold = next((holds[x] for x in ch if x in holds), None)
            town = next((x for x in ch if town_kw & set((locs.get(x) or {}).get('kw', []))), None)
            inside = ch[:ch.index(town)] if town else []
            house = next((x for x in inside if house_kw & set((locs.get(x) or {}).get('kw', []))), None)
            edids = [(lctn.get(x) or {}).get('edid') or desc(x) for x in ch]
            if not where:
                why = 'it stands in no world or cell'
            elif not hold:
                why = 'its place (%s) is in no hold' % (' < '.join(edids) or 'no location')
            elif not town:
                why = 'its place (%s) is in %s but in no town' % (' < '.join(edids), hold)
            elif house:
                why = 'its place (%s) is a house\'s ground in %s' % (' < '.join(edids), lctn[town]['edid'])
        if why:
            refused[desc(k)] = {'base': b['edid'], 'by': r['by'], 'why': why}
            continue
        rz, s = r['pos'][5], r['scale'] or 1.0
        x1, y1, z1, x2, y2, z2 = b['bounds']
        cx, cy = (x1 + x2) / 2.0 * s, (y1 + y2) / 2.0 * s
        # Skyrim turns a reference clockwise seen from above.
        px = r['pos'][0] + cx * math.cos(rz) + cy * math.sin(rz)
        py = r['pos'][1] - cx * math.sin(rz) + cy * math.cos(rz)
        pz = r['pos'][2] + z1 * s
        reach = math.hypot((x2 - x1) / 2.0, (y2 - y1) / 2.0) * s + ARM
        place = (locs.get(town) or {}).get('name') or lctn[town]['edid']
        rows.append({'ref': desc(k), 'base': b['edid'] + ' ' + desc(r['base']), 'by': r['by'],
                     'hold': hold, 'place': place, 'location': ' < '.join(edids),
                     'world': where, 'pos': [round(px), round(py), round(pz)], 'reach': int(math.ceil(reach)),
                     'key': k})

    stalls, ids = [], set()
    for r in rows:
        twin = next((s for s in stalls if s['world'] == r['world'] and
                     math.hypot(s['pos'][0] - r['pos'][0], s['pos'][1] - r['pos'][1]) < SAME_SPOT), None)
        if twin:
            twin.setdefault('samePlace', []).append(r['ref'])
            continue
        r['id'] = '%s-%x' % (r['hold'], r['key'][1])
        if r['id'] in ids:
            print('STOP. two stalls would both be %s; the id rule needs another part' % r['id'])
            return 1
        ids.add(r['id'])
        stalls.append(r)
    for s in stalls:
        del s['key']
    stalls.sort(key=lambda s: (s['hold'], s['place'], s['id']))

    print('')
    print('%d stall(s) in the holds\' towns' % len(stalls))
    for s in stalls:
        print('  %-20s %-10s %-22s %-22s %s reach %d  %s%s' % (
            s['id'], s['hold'], s['place'], s['world'], ','.join(str(v) for v in s['pos']), s['reach'],
            s['base'], (' (also ' + ', '.join(s['samePlace']) + ')') if s.get('samePlace') else ''))
    print('%d refused' % len(refused))
    for k, v in sorted(refused.items()):
        print('  %-36s %-28s %s' % (k, v['base'], v['why']))

    payload = {
        'note': ('Every market stall the server knows, one row a stall. Built by scripts/dev/Build-MarketStalls.py '
                 'out of the plugins. Do not hand edit.'),
        'issue': 3160,
        'rule': ('A stall is a placed static whose mesh is one of Skyrim\'s market stall counters, placed at the start, '
                 'standing in a place whose location reaches a hold and is, or is inside, a location marked as a city, '
                 'a town or a settlement, with no house\'s location between. References of one counter closer than %d units across the ground are one '
                 'stall, kept from the earlier plugin. The point is the middle of the counter\'s bounds on the ground '
                 'it stands on; the reach is half the bounds\' diagonal and %d units more.' % (SAME_SPOT, ARM)),
        'stalls': [{k: s[k] for k in ('id', 'hold', 'place', 'world', 'pos', 'reach', 'location', 'ref', 'base', 'by',
                                      'samePlace') if k in s} for s in stalls],
        'refused': refused,
        'builtAgainst': [{'name': pl.name, 'size': pl.size, 'sha256': pl.sha256} for pl in plugins],
    }
    out_text = json.dumps(payload, indent=1, sort_keys=True) + '\n'
    if args.check:
        old = io.open(args.out, encoding='utf-8').read() if os.path.isfile(args.out) else ''
        print('')
        if old != out_text:
            print('--check: game/data/market-stalls.json differs from what the plugins give now. Run this without --check.')
            return 1
        print('--check: the table is what the plugins give. Nothing was written.')
        return 0
    io.open(args.out, 'w', encoding='utf-8', newline='\n').write(out_text)
    print('')
    print('wrote %s, %d stall(s). Now run node scripts/dev/Build-MarketStallsGamemode.js' % (args.out, len(stalls)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
