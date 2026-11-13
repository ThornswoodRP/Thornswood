"""
hold-only-cases.py

#3150. Patrick's page answer, 22 Oct 2026 (A): each hold has 2 to 3
hold-only plants, ores or animals, which grow only in their own hold.
scripts/mods/Build-LastPlugin.py (step 10) switches off every placed one
standing outside its hold, once game/data/last-plugin-policy.json holdOnly
names them. This holds the builder's part on small records made here,
without the game:

  1  a policy with no holdOnly names nothing, so the plugin is built as it
     was, and the committed policy is read without stopping the build;
  2  a holdOnly list is read against the plant and ore tables: each produce
     gives its bases, and a produce named twice, a hold that is not one of
     the nine, a kind that is not a plant or an ore, a name the table does
     not give, and a hold with fewer than 2 or more than 3 stop the build;
  3  the quest and trade tables name the placed references they draw from;
  4  a placed reference's hold is the NPC catalogue's rule: the location it
     carries, then its cell's, then the ground under a world's persistent
     cell, then the nearest ground within six cells that names a place,
     with the policy's place holds read in place of the records' own.

    python tests/hold-only-cases.py

game/tests/test-3150-hold-builder.js runs it on the build check.

Prints PASS or FAIL per check and exits 1 when any fails.
"""
import importlib.util
import json
import os
import shutil
import struct
import sys
import tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
spec = importlib.util.spec_from_file_location('build_last', os.path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py'))
bl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bl)

passed = failed = 0


def yes(what, ok):
    global passed, failed
    if ok:
        passed += 1
        print('PASS  ' + what)
    else:
        failed += 1
        print('FAIL  ' + what)


def stops(fn, *a):
    try:
        fn(*a)
    except SystemExit as x:
        return str(x)
    return ''


# 1
yes('1 a policy with no holdOnly names nothing', bl.hold_only_rows({}) == ({}, []) and
    bl.hold_only_rows({'holdOnly': {'resources': []}}) == ({}, []))
policy = json.load(open(os.path.join(ROOT, 'game', 'data', 'last-plugin-policy.json'), encoding='utf-8'))
yes('1 the committed policy is read against the committed tables without stopping the build',
    stops(bl.hold_only_rows, policy) == '')

# 2: plant and ore tables of a root made here, two produce for each hold.
root = tempfile.mkdtemp(prefix='hold-only-cases-')
real_root = bl.ROOT
try:
    os.makedirs(os.path.join(root, 'game', 'data'))
    harvests, ores, rows = {}, {}, []
    for i, hold in enumerate(bl.NINE_HOLDS):
        plant, ore = '%x:Skyrim.esm' % (0x1000 + i), '%x:Skyrim.esm' % (0x2000 + i)
        harvests['%x:Skyrim.esm' % (0x3000 + i)] = {'produce': plant, 'name': 'Plant %d' % i}
        harvests['%x:Skyrim.esm' % (0x3100 + i)] = {'produce': plant, 'name': 'Plant %d' % i}
        ores['%x:Skyrim.esm' % (0x4000 + i)] = {'ore': ore, 'name': 'Ore %d' % i}
        rows.append({'produce': plant, 'name': 'Plant %d' % i, 'kind': 'plant', 'holdEdid': hold})
        rows.append({'produce': ore, 'name': 'Ore %d' % i, 'kind': 'ore', 'holdEdid': hold})
    harvests['5000:Skyrim.esm'] = {'produce': '6000:Skyrim.esm', 'name': 'Elsewhere'}
    json.dump({'harvests': harvests}, open(os.path.join(root, 'game', 'data', 'harvests.json'), 'w'))
    json.dump({'ores': ores}, open(os.path.join(root, 'game', 'data', 'ores.json'), 'w'))
    bl.ROOT = root

    def with_rows(rs):
        return {'holdOnly': {'resources': rs}}

    by_base, made = bl.hold_only_rows(with_rows(rows))
    yes('2 every base that gives a hold-only produce is hold-only, and no other',
        len(by_base) == 27 and by_base[('skyrim.esm', 0x3000)]['name'] == 'Plant 0' and
        by_base[('skyrim.esm', 0x3100)]['name'] == 'Plant 0' and by_base[('skyrim.esm', 0x4008)]['name'] == 'Ore 8' and
        ('skyrim.esm', 0x5000) not in by_base)
    yes('2 each row comes back with its bases',
        made[0]['bases'] == ['3000:Skyrim.esm', '3100:Skyrim.esm'] and made[1]['bases'] == ['4000:Skyrim.esm'])
    yes('2 a produce named twice stops the build', 'twice' in stops(bl.hold_only_rows, with_rows(rows + [rows[0]])))
    yes('2 a hold that is not one of the nine stops the build',
        'not one of the nine holds' in stops(bl.hold_only_rows, with_rows([dict(rows[0], holdEdid='DLC2SolstheimLocation')] + rows[1:])))
    yes('2 a kind that is not a plant or an ore stops the build',
        'a plant or an ore' in stops(bl.hold_only_rows, with_rows([dict(rows[0], kind='animal')] + rows[1:])))
    yes('2 a name the table does not give for that produce stops the build',
        'gives it from Plant 0' in stops(bl.hold_only_rows, with_rows([dict(rows[0], name='Something')] + rows[1:])) and
        'gives it from nothing' in stops(bl.hold_only_rows, with_rows([dict(rows[0], produce='7777:Skyrim.esm')] + rows[1:])))
    yes('2 a hold with one stops the build', '2 to 3' in stops(bl.hold_only_rows, with_rows(rows[1:])))
    extra = []
    for k in range(2):
        p = '%x:Skyrim.esm' % (0x8000 + k)
        harvests['%x:Skyrim.esm' % (0x8100 + k)] = {'produce': p, 'name': 'More %d' % k}
        extra.append({'produce': p, 'name': 'More %d' % k, 'kind': 'plant', 'holdEdid': bl.NINE_HOLDS[0]})
    json.dump({'harvests': harvests}, open(os.path.join(root, 'game', 'data', 'harvests.json'), 'w'))
    yes('2 a hold with three is taken, and one with four stops the build',
        stops(bl.hold_only_rows, with_rows(rows + extra[:1])) == '' and
        '2 to 3' in stops(bl.hold_only_rows, with_rows(rows + extra)))

    # 3
    json.dump({'sources': [{'reference': '1a2b:Skyrim.esm'}]},
              open(os.path.join(root, 'game', 'data', 'merchant-scarce-harvest.json'), 'w'))
    json.dump({'sources': [{'reference': '3c:Dawnguard.esm'}]},
              open(os.path.join(root, 'game', 'data', 'merchant-orchard.json'), 'w'))
    yes('3 the quest and trade tables name what they draw from, and a missing table names nothing',
        bl.quest_sources() == {('skyrim.esm', 0x1a2b), ('dawnguard.esm', 0x3c)})
finally:
    bl.ROOT = real_root
    shutil.rmtree(root, ignore_errors=True)


# 4: a small load order, the way build() hands it over.
class FakePlugin(object):
    def __init__(self, name, index, records):
        self.name, self.index, self.masters = name, index, []
        self.records = records

    def gid(self, fid):
        return ('skyrim.esm', fid & 0xFFFFFF)

    def data(self, e):
        return bl.pack_subrecords(self.records[e.fid])


def fid4(f):
    return struct.pack('<I', f)


WORLD = 0x3C
records = {
    0x100: [(b'EDID', b'WhiterunHoldLocation\x00')],
    0x101: [(b'EDID', b'SomeTownLocation\x00'), (b'PNAM', fid4(0x100))],
    0x102: [(b'EDID', b'RiftHoldLocation\x00')],
    0x103: [(b'EDID', b'NoParentLocation\x00')],
    # An interior in a town of Whiterun hold.
    0x200: [(b'EDID', b'TownHouse\x00'), (b'XLCN', fid4(0x101))],
    # Ground at 0,0 in the Rift, and at 3,0 and 20,0 naming no place.
    0x201: [(b'XCLC', struct.pack('<ii', 0, 0)), (b'XLCN', fid4(0x102))],
    0x202: [(b'XCLC', struct.pack('<ii', 3, 0))],
    0x204: [(b'XCLC', struct.pack('<ii', 20, 0))],
    # The world's persistent cell.
    0x203: [],
    # An interior whose location has no parent, which the policy puts in Whiterun.
    0x205: [(b'XLCN', fid4(0x103))],
    # An interior with no location, which the policy gives the Rift's.
    0x206: [],
}


def pos(x, y):
    return (b'DATA', struct.pack('<6f', x, y, 0, 0, 0, 0))


refs = {
    0x300: (0x200, [(b'NAME', fid4(0x3000)), (b'XLCN', fid4(0x102)), pos(0, 0)]),
    0x301: (0x200, [(b'NAME', fid4(0x3000)), pos(0, 0)]),
    0x302: (0x203, [(b'NAME', fid4(0x3000)), pos(100, 100)]),
    0x303: (0x202, [(b'NAME', fid4(0x3000)), pos(3 * 4096 + 10, 10)]),
    0x304: (0x204, [(b'NAME', fid4(0x3000)), pos(20 * 4096 + 10, 10)]),
    0x305: (0x205, [(b'NAME', fid4(0x3000)), pos(0, 0)]),
    0x306: (0x206, [(b'NAME', fid4(0x3000)), pos(0, 0)]),
}
for f, (_, subs) in refs.items():
    records[f] = subs
sky = FakePlugin('Skyrim.esm', 0, records)
plugins = [sky]
win = {}
for f in (0x100, 0x101, 0x102, 0x103):
    win[(b'LCTN', ('skyrim.esm', f))] = bl.Entry(b'LCTN', 0, f, 0, 0, None, 0)
for f in (0x200, 0x205, 0x206):
    win[(b'CELL', ('skyrim.esm', f))] = bl.Entry(b'CELL', 0, f, 0, 0, (None, 0, 0, False), 0)
for f in (0x201, 0x202, 0x204):
    win[(b'CELL', ('skyrim.esm', f))] = bl.Entry(b'CELL', 0, f, 0, 0, (WORLD, 1, 1, False), 0)
win[(b'CELL', ('skyrim.esm', 0x203))] = bl.Entry(b'CELL', 0, 0x203, 0, 0, (WORLD, None, None, True), 0)
ref = {f: bl.Entry(b'REFR', 0, f, 0, 0, (WORLD if c in (0x201, 0x202, 0x203, 0x204) else None, c, 0, 0, 0), 0)
       for f, (c, _) in refs.items()}

place = bl.ref_holds(plugins, win)
yes('4 the location a reference carries comes first', place(ref[0x300]) == 'RiftHoldLocation')
yes('4 then its cell\'s, up the parent chain', place(ref[0x301]) == 'WhiterunHoldLocation')
yes('4 in a world\'s persistent cell, the ground under it', place(ref[0x302]) == 'RiftHoldLocation')
yes('4 on ground that names no place, the nearest ground within six cells that does', place(ref[0x303]) == 'RiftHoldLocation')
yes('4 and none when nothing within six cells names one', place(ref[0x304]) is None)
yes('4 without the policy, a location with no parent and a cell with none are in no hold',
    place(ref[0x305]) is None and place(ref[0x306]) is None)
planned = bl.ref_holds(plugins, win, {('skyrim.esm', 0x103): ('skyrim.esm', 0x100)},
                       {('skyrim.esm', 0x206): ('skyrim.esm', 0x102)})
yes('4 the policy\'s place holds are read in place of the records\' own',
    planned(ref[0x305]) == 'WhiterunHoldLocation' and planned(ref[0x306]) == 'RiftHoldLocation' and
    planned(ref[0x301]) == 'WhiterunHoldLocation')

print('')
print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
