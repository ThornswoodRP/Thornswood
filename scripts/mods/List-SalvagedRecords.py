"""
List-SalvagedRecords.py

Writes scripts\\mods\\content-salvaged.json: every record Thornswood-Content.esp
carried that Thornswood's own tools did not add, what each one is used by, what
became of it (#2553), and the sha256 of every version of it the repository has
held. Add-ContentRecords.py reads the list to take out what goes, and
game\\tests\\test-2553-salvaged-gone.js reads it to prove nothing salvaged is left.

WHY (#2553)

Until #400 the plugin's header said its crafting and gathering records were
salvaged from another server's plugin, and no permission from that server's
makers is recorded (records\\asset-provenance.json). Patrick, 15 October 2026,
option B on #2177: the salvaged records are remade as Thornswood's own and the
salvaged ones removed.

WHICH RECORDS ARE SALVAGED

The plugin came to this repository on 13 September (commit 0571ad9a, then at
tools\\Thornswood-Content.esp). Thornswood's own tool before the repository,
tools\\thornswood-src\\patch_esp.py, had added the books and menus numbered
0x05E80000 and up (BASE in its content.py): the welcome book, the writs, the
passages and the four menus. Every other record in that copy is salvaged.
Everything added since came from this repository's tools
(Add-ContentRecords.py, and Collapse-DwarvenIngots.py until #5191 folded it
into Add-ContentRecords.py), each with its own issue.

So a record is salvaged when its form id is in the 13 September copy and not
in the 0x05E8 range. The editor ids written here are the ones the plugin has
carried since b8e57da renamed them; the old ones carried the other server's
prefix and are not written anywhere.

WHAT IS HASHED

A record's subrecords, inflated when compressed, with its editor id left out:
the same bytes under another name are still the same record. One hash for
every distinct version, read from every commit of the plugin up to
SALVAGED_THROUGH, the last main commit before the remake.

Usage:
    python scripts/mods/List-SalvagedRecords.py           brings the list up to the station table
    python scripts/mods/List-SalvagedRecords.py --check   exit 1 if it differs
    --history                 rebuild the whole list from the plugin's history
    --masters <Data folder>   where Skyrim.esm and the DLC are read from
                              (default C:\\Thornswood\\Game\\Data)

WHAT CAN STILL CHANGE (#4354)

Everything the history gives is fixed at SALVAGED_THROUGH: which records were
salvaged, every version's hash, what each override did, what was remade and
what names it. One thing moves after #2553, which salvaged cell or worldspace
a station Thornswood places stands in (game\\data\\station-sites.json): one a
station stands in stays as Bethesda's, and one no station stands in is
dropped. The study desk in the Hall of the Elements (#1387) was the first
station to stand in a cell the list had dropped.

So by default this reads what the history gave from the committed list and
sets each salvaged cell and worldspace from the station table, by the same
rule the history build uses (world_rule). It needs no history, so it runs on
the box, which is sent a commit's files and no history (Run-OnBox.ps1). It
reads the masters only for a cell or worldspace that newly stays, for the
winning master's own hash, and stops without them.

--history rebuilds the whole list as #2553 first did. That needs the
repository's full history (the 13 September and 25 September copies are on
their own roots) and the five masters, to say what each override of Skyrim's
own placements did. Read only apart from the list.
"""

import argparse
import hashlib
import json
import os
import struct
import subprocess
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'content-salvaged.json')
PLUGIN = 'Thornswood-Content.esp'
REPO_PATH = 'game/content/Thornswood-Content.esp'

# The copy the repository started with, and the hotfix root that carried it
# before game/content existed.
FIRST = ('0571ad9a0d906030b9aecab03d39c7ff87c396ce', 'tools/Thornswood-Content.esp')
HOTFIX = ('ef1ae5a637388fb5f4ef4ea8fd4b673afcb9a338', 'tools/Thornswood-Content.esp')
# The last main commit before the remake (#2553). Versions after it are ours.
SALVAGED_THROUGH = 'b7c20293fb9fab4db317f3ff61dff3ea8bea1322'

# Thornswood's own records before the repository: patch_esp.py's BASE.
OWN_BEFORE = (0x05E80000, 0x05E8FFFF)

# What each salvaged base record became. The rest of the rules are below.
REMADE = {
    0x501547F: 'the kiln keyword, the bench every charcoal recipe and the splint name',
    0x5042E6B: 'the alchemy lab keyword, the bench of the poultice and the remedy',
    0x500593B: 'the notice board, which the server stands in every town (#2516)',
    0x5015481: 'Poor Charcoal', 0x5015482: 'Charcoal', 0x5015484: 'Charcoal Briquette',
    0x5015485: 'Coke',
    0x5DBF8B3: "the beehive, a farmer's (farmer.md)",
    0x501547E: 'the charcoal kiln, the Charburner\'s bench',
    0x5042E69: "the alchemy lab, the Physicker's bench",
    0x5DDE4EF: "the salt quarry, a miner's (miner.md)",
    0x5015480: 'Poor Charcoal at the kiln', 0x5015486: 'Charcoal at the kiln',
    0x5015487: 'Charcoal Briquette at the kiln', 0x5015488: 'Coke at the kiln',
    0x501548D: 'the pickaxe at a forge', 0x501548E: "the woodcutter's axe at a forge",
}

# Six recipes come out the same bytes as a version the plugin held, because
# every field of them is a fact Thornswood's rulebook states: what goes in, how
# many, what comes out, at which bench. The four kiln recipes are the
# Charburner page's table; the pickaxe and the axe are the Edgewright page's,
# as Thornswood made them in #1654 by adding the handle. The harness rebuilds
# each from its page's row and holds it to it.
SAME_BY_DESIGN = {
    0x501548D: 'docs/systems/professions/smith/edgewright.md: Pickaxe, 1 Iron Ingot and 1 Tool Handle, makes 1, at the forge',
    0x501548E: "docs/systems/professions/smith/edgewright.md: Woodcutter's Axe, 1 Iron Ingot and 1 Tool Handle, makes 1, at the forge",
    0x5015480: 'docs/systems/professions/woodworker/charburner.md: Poor Charcoal, 2 firewood, makes 1, at the kiln',
    0x5015486: 'docs/systems/professions/woodworker/charburner.md: Charcoal, 4 firewood, makes 1, at the kiln',
    0x5015487: 'docs/systems/professions/woodworker/charburner.md: Charcoal Briquette, 7 firewood, makes 1, at the kiln',
    0x5015488: 'docs/systems/professions/woodworker/charburner.md: Coke, 12 firewood, makes 1, at the kiln',
}

# The other server's placements of Thornswood's four stations. Until
# Patrick's A of 16 October (#2553) they stayed, because they were the only
# kilns, salt quarries, placed hives and Thornswood labs in the world. Since
# then Thornswood stands its own where game/data/station-sites.json measures
# (scripts/dev/Build-StationSites.py), and these go.
STATIONS = {0x5042E69: 'alchemy lab', 0x501547E: 'charcoal kiln', 0x5DBF8B3: 'beehive',
            0x5DDE4EF: 'salt quarry'}
STATION_COUNTS = {'alchemy lab': 25, 'charcoal kiln': 8, 'beehive': 13, 'salt quarry': 11}
STATION_SITES = os.path.join(ROOT, 'game', 'data', 'station-sites.json')
PLUGIN_FILE = os.path.join(ROOT, 'game', 'content', PLUGIN)

COMPRESSED = 0x00040000


def station_cells():
    """Every cell, and every worldspace of an outdoor site, a station
    Thornswood places stands in, as (object id, plugin name in lower case)."""
    out = set()
    for row in json.load(open(STATION_SITES, encoding='utf-8'))['sites'].values():
        for field in ('cell',) + (() if row['interior'] else ('space',)):
            obj, owner = row[field].split(':', 1)
            out.add((int(obj, 16), owner.lower()))
    return out


def world_rule(held):
    """What becomes of a salvaged cell or worldspace (#2553): it stays as
    Bethesda's while a station Thornswood places stands in it, and is dropped
    once none does. The history build and update() both say it here."""
    if held:
        return ("Bethesda's", 'a station Thornswood places stands in it (game/data/station-sites.json), so '
                              'it stays, written by the tool from the winning master\'s own record')
    return ('dropped', 'nothing of Thornswood\'s is placed in it once the placements above go')


def git(*args, binary=False):
    p = subprocess.run(['git', '-C', ROOT] + list(args), capture_output=True)
    if p.returncode != 0:
        raise SystemExit('STOP. git %s: %s' % (' '.join(args), p.stderr.decode('utf-8', 'replace').strip()))
    return p.stdout if binary else p.stdout.decode('utf-8')


def subrecords(data):
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
        out.append((tag, data[i + 6:i + 6 + size]))
        i += 6 + size
    return out


def records(buf):
    """Every record as (tag, flags, fid, data, world, cell), data inflated."""
    hs = struct.unpack_from('<I', buf, 4)[0]
    out, stack, p = [], [], 24 + hs
    while p + 24 <= len(buf):
        while stack and p >= stack[-1][0]:
            stack.pop()
        tag = buf[p:p + 4]
        size = struct.unpack_from('<I', buf, p + 4)[0]
        if tag == b'GRUP':
            stack.append((p + size, struct.unpack_from('<i', buf, p + 12)[0],
                          struct.unpack_from('<I', buf, p + 8)[0]))
            p += 24
            continue
        flags, fid = struct.unpack_from('<II', buf, p + 8)
        data = buf[p + 24:p + 24 + size]
        if flags & COMPRESSED:
            data = zlib.decompress(data[4:])
        world = next((lb for (_, gt, lb) in stack if gt == 1), None)
        cell = next((lb for (_, gt, lb) in reversed(stack) if gt in (6, 8, 9, 10)), None)
        out.append((tag.decode('ascii'), flags, fid, data, world, cell))
        p += 24 + size
    return out


def masters(buf):
    hs = struct.unpack_from('<I', buf, 4)[0]
    return [b.rstrip(b'\x00').decode('latin1') for t, b in subrecords(buf[24:24 + hs]) if t == b'MAST']


def edid(data):
    for t, b in subrecords(data):
        if t == b'EDID':
            return b.rstrip(b'\x00').decode('latin1')
    return ''


def body_hash(data):
    """The record's subrecords without its editor id, hashed."""
    rest = b''.join(t + struct.pack('<I', len(b)) + b for t, b in subrecords(data) if t != b'EDID')
    return hashlib.sha256(rest).hexdigest()


def localise(d, names):
    """<hex>:<plugin> as the form id the plugin writes, its master's index on top."""
    obj, owner = d.split(':', 1)
    return ([n.lower() for n in names].index(owner.lower()) << 24) | int(obj, 16)


def content_tool():
    import importlib.util
    spec = importlib.util.spec_from_file_location('add_content_records', os.path.join(HERE, 'Add-ContentRecords.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def desc(fid, names):
    idx = fid >> 24
    owner = names[idx] if idx < len(names) else PLUGIN
    return '%x:%s' % (fid & 0xFFFFFF, owner)


def versions():
    """(commit, path, bytes) of every copy of the plugin up to SALVAGED_THROUGH."""
    out = []
    for commit, path in (FIRST, HOTFIX):
        out.append((commit, path, git('show', '%s:%s' % (commit, path), binary=True)))
    for commit in reversed(git('log', '--format=%H', SALVAGED_THROUGH, '--', REPO_PATH).split()):
        out.append((commit, REPO_PATH, git('show', '%s:%s' % (commit, REPO_PATH), binary=True)))
    return out


def users(fid, names):
    """Tracked files outside docs/archive that name this record's descriptor."""
    d = desc(fid, names)
    # Not a hex digit in front, so 593b is not found inside 1593b.
    pattern = '(^|[^0-9a-fA-F])' + d.replace('.', '\\.')
    p = subprocess.run(['git', '-C', ROOT, 'grep', '-l', '-i', '-E', pattern, SALVAGED_THROUGH, '--',
                        '.', ':!docs/archive', ':!game/content', ':!scripts/mods/content-salvaged.json'],
                       capture_output=True)
    return sorted({line.split(':', 1)[1] for line in p.stdout.decode('utf-8').splitlines() if ':' in line})


def bethesda_placements(masters_dir, names, fids):
    """{fid: (flags, {tag: bytes})} for each of Skyrim's own placements in
    fids, the winning one among the plugin's masters, read with
    Build-LastPlugin.py's reader."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('build_last_plugin', os.path.join(HERE, 'Build-LastPlugin.py'))
    last = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(last)
    low = [n.lower() for n in names]
    want = {(low[f >> 24], f & 0xFFFFFF): f for f in fids}
    out = {}
    for i, m in enumerate(names):
        path = os.path.join(masters_dir, m)
        if not os.path.isfile(path):
            raise SystemExit('STOP. %s is not in %s; give --masters the game\'s Data folder.' % (m, masters_dir))
        src = last.Plugin(path, m, i)
        for e in src.walk({b'REFR'}):
            f = want.get(src.gid(e.fid))
            if f is not None:
                out[f] = (e.flags, dict(subrecords(src.data(e))))
    return out


def what_it_did(flags, subs, master):
    """What a salvaged override did to Skyrim's own placement, in words."""
    import math
    mflags, msubs = master
    did = []
    if flags & 0x800 and not mflags & 0x800:
        did.append('switches it off')
    else:
        a = struct.unpack('<6f', subs[b'DATA'])
        b = struct.unpack('<6f', msubs[b'DATA'])
        moved = max(abs(a[i] - b[i]) for i in range(3))
        turned = max(abs(math.remainder(a[i] - b[i], 2 * math.pi)) for i in range(3, 6))
        if moved > 0.5:
            did.append('moves it %d units' % round(moved))
        if turned > 0.01:
            did.append('turns it %d degrees' % round(math.degrees(turned)))
    if subs.get(b'XSCL') != msubs.get(b'XSCL'):
        did.append('changes its size')
    for tag, words in ((b'XLKR', 'its links'), (b'VMAD', 'its scripts'), (b'XRGD', 'its ragdoll')):
        if subs.get(tag) != msubs.get(tag):
            did.append('changes ' + words)
    return did


def build(masters_dir):
    vers = versions()
    first = records(vers[0][2])
    names = masters(vers[0][2])
    salvaged = [(t, f) for (t, fl, f, d, w, c) in first if not (OWN_BEFORE[0] <= f <= OWN_BEFORE[1])]
    salvaged_ids = {f for _, f in salvaged}
    hashes = {f: [] for f in salvaged_ids}
    last_seen = {}
    for commit, path, buf in vers:
        for (t, fl, f, d, w, c) in records(buf):
            if f in salvaged_ids:
                h = body_hash(d)
                if h not in hashes[f]:
                    hashes[f].append(h)
                last_seen[f] = (t, fl, d, w, c)
    final = {f for (t, fl, f, d, w, c) in records(vers[-1][2])}
    last = records(vers[-1][2])

    # The other server's placements of the stations, and the cells and
    # worldspaces Thornswood's own placements stand in, which the plugin
    # carries as Bethesda's records.
    stations = set()
    for (t, fl, f, d, w, c) in last:
        if t != 'REFR' or f not in salvaged_ids:
            continue
        base = next(struct.unpack('<I', b)[0] for tt, b in subrecords(d) if tt == b'NAME')
        if base in STATIONS and not fl & 0x800:
            stations.add(f)
    low = [n.lower() for n in names]
    cells = station_cells()
    holders = {f for (t, fl, f, d, w, c) in last
               if t in ('CELL', 'WRLD') and f in salvaged_ids and f >> 24 < len(low) and
               (f & 0xFFFFFF, low[f >> 24]) in cells}
    overrides = [f for (t, fl, f, d, w, c) in last
                 if t == 'REFR' and f in salvaged_ids and f >> 24 != 5]
    bethesda = bethesda_placements(masters_dir, names, overrides)

    rows = []
    for t, f in salvaged:
        row = {'formId': desc(f, names), 'type': t}
        if f not in final:
            row['disposition'] = 'gone before #2553'
            row['editorId'] = ''
            if t == 'BOOK':
                row['why'] = 'a skill manual, taken out by Remove-DeadRecords.ps1 before 25 September'
            elif f in (0x5DF7B34, 0x5DFCC75):
                row['why'] = 'the Execution Block and its placement in Solitude, taken out in #954 (#400)'
            else:
                row['why'] = 'taken out before #2553'
            row['dataSha256'] = hashes[f]
            rows.append(row)
            continue
        tt, fl, d, w, c = last_seen[f]
        row['editorId'] = edid(d) if t not in ('REFR',) else ''
        if t == 'REFR':
            base = next(struct.unpack('<I', b)[0] for x, b in subrecords(d) if x == b'NAME')
            row['base'] = desc(base, names)
            row['cell'] = desc(c, names)
            row['disposition'] = 'dropped'
            if f in stations:
                row['why'] = ('one of the other server\'s %d placements of Thornswood\'s %s, at the spot it '
                              'chose; Thornswood stands its own where game/data/station-sites.json measures '
                              '(Patrick, A on #2553)' % (STATION_COUNTS[STATIONS[base]], STATIONS[base]))
            else:
                if f >> 24 != 5:
                    did = what_it_did(fl, dict(subrecords(d)), bethesda[f])
                    row['did'] = did or ['nothing but the location ref type the editor writes']
                    row['why'] = ('the other server\'s change to Skyrim\'s own placement; no Thornswood '
                                  'design asks for it, so Skyrim\'s own stands again')
                elif base == 0x500593B:
                    row['why'] = 'a notice board placed switched off; the server stands every board (#2516)'
                else:
                    row['why'] = 'an object of Skyrim\'s placed where the other server chose; no Thornswood design asks for it'
        elif t in ('CELL', 'WRLD'):
            row['disposition'], row['why'] = world_rule(f in holders)
        elif f in REMADE:
            row['disposition'] = 'remade'
            row['why'] = REMADE[f]
            if f in SAME_BY_DESIGN:
                row['sameByDesign'] = SAME_BY_DESIGN[f]
            row['usedBy'] = users(f, names)
        else:
            row['disposition'] = 'dropped'
            row['why'] = 'nothing in the repository names it'
            row['usedBy'] = users(f, names)
        row['dataSha256'] = hashes[f]
        rows.append(row)

    # A cell or worldspace kept as Bethesda's is written by Add-ContentRecords.py
    # from the winning master's own record. Where the salvaged copy was those
    # very bytes (RiftenWorld, since a well bucket stands in it, #1382), the
    # plugin's record is Bethesda's and not the other server's, so the master's
    # own hash is kept beside it: the tool and the harness hold the record to
    # it with no game to read.
    kept = [(r, (r['type'].encode('ascii'), localise(r['formId'], names))) for r in rows
            if r['disposition'] == "Bethesda's"]
    if kept:
        own = content_tool().bethesdas_world_records(masters_dir, names, [k for _, k in kept])
        if own is None:
            raise SystemExit('STOP. the masters are not in %s, and the cells and worldspaces kept as '
                             "Bethesda's are hashed from them. Give --masters the game's Data folder." % masters_dir)
        for r, k in kept:
            r['bethesdaSha256'] = body_hash(own[k][1])

    counts = count(rows)
    return {
        'issue': 2553,
        'decided': ('Patrick, 15 October 2026, option B on #2177: no permission from the other '
                    'server\'s makers is recorded, so the salvaged records are remade as '
                    'Thornswood\'s own and the salvaged ones removed.'),
        'builtBy': 'scripts/mods/List-SalvagedRecords.py',
        'salvagedThrough': SALVAGED_THROUGH,
        'salvaged': ('every record of the 13 September copy (%s) outside 0x05E80000 to 0x05E8FFFF, '
                     'which Thornswood\'s own patch_esp.py added' % FIRST[0][:8]),
        'hashed': 'sha256 of the subrecords, inflated, editor id left out, one per distinct version',
        'sources': [{'commit': c, 'path': p, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()}
                    for c, p, b in vers],
        'counts': dict(sorted(counts.items())),
        'records': rows,
    }


def count(rows):
    counts = {}
    for r in rows:
        k = '%s %s' % (r['type'], r['disposition'])
        counts[k] = counts.get(k, 0) + 1
    return counts


def update(masters_dir):
    """The committed list with each salvaged cell and worldspace set from
    the station table by world_rule, everything else as the history gave
    it (WHAT CAN STILL CHANGE, above). No history is read; the masters only
    for a row that newly stays."""
    if not os.path.isfile(OUT):
        raise SystemExit('STOP. %s is not here, and only --history on a full clone can write it from '
                         'nothing.' % OUT)
    reg = json.load(open(OUT, encoding='utf-8'))
    cells = station_cells()
    rows, new = [], []
    for r in reg['records']:
        if r['type'] not in ('CELL', 'WRLD') or r['disposition'] == 'gone before #2553':
            rows.append(r)
            continue
        obj, owner = r['formId'].split(':', 1)
        held = (int(obj, 16), owner.lower()) in cells
        row = {'formId': r['formId'], 'type': r['type'], 'editorId': r['editorId']}
        row['disposition'], row['why'] = world_rule(held)
        row['dataSha256'] = r['dataSha256']
        if held and r.get('bethesdaSha256') and r['disposition'] == "Bethesda's":
            row['bethesdaSha256'] = r['bethesdaSha256']
        elif held:
            new.append(row)
        rows.append(row)
    if new:
        # A row that newly stays is written by Add-ContentRecords.py from the
        # winning master's own record, so the list keeps that record's hash,
        # as the history build does.
        names = masters(open(PLUGIN_FILE, 'rb').read())
        keys = [(r['type'].encode('ascii'), localise(r['formId'], names)) for r in new]
        own = content_tool().bethesdas_world_records(masters_dir, names, keys)
        if own is None:
            raise SystemExit('STOP. a station now stands in %s, which the list drops. It stays as Bethesda\'s, '
                             'written from the winning master\'s own record, so the list keeps that record\'s '
                             'hash, and the masters are not in %s. Give --masters the game\'s Data folder. '
                             'Nothing was written.'
                             % (', '.join('%s %s' % (r['type'], r['formId']) for r in new), masters_dir))
        for r, k in zip(new, keys):
            r['bethesdaSha256'] = body_hash(own[k][1])
    reg['counts'] = dict(sorted(count(rows).items()))
    reg['records'] = rows
    return reg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--history', action='store_true',
                    help='rebuild the whole list from the plugin\'s history, on a full clone')
    ap.add_argument('--masters', default=r'C:\Thornswood\Game\Data',
                    help="the game's Data folder: Skyrim's own placements, to say what each override did")
    args = ap.parse_args()
    if args.history and subprocess.run(['git', '-C', ROOT, 'cat-file', '-e', FIRST[0] + '^{commit}'],
                                       capture_output=True).returncode != 0:
        raise SystemExit('STOP. --history reads the plugin\'s whole history, and this checkout does not have it '
                         '(no git, or a shallow clone). Run it on a full clone, or run this without --history.')
    text = json.dumps(build(args.masters) if args.history else update(args.masters), indent=1, ensure_ascii=True) + '\n'
    if args.check:
        have = open(OUT, encoding='utf-8').read() if os.path.isfile(OUT) else ''
        if have != text:
            print('content-salvaged.json is not what the %s gives. Run this without --check.'
                  % ('history' if args.history else 'station table'))
            return 1
        print('ok    content-salvaged.json is what the %s gives' % ('history' if args.history else 'station table'))
        return 0
    open(OUT, 'w', encoding='utf-8', newline='\n').write(text)
    print('wrote %s' % OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
