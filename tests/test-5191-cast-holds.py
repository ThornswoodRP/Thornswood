"""
test-5191-cast-holds.py

    python tests/test-5191-cast-holds.py

#5191, stage 4e, Patrick's B on q-5191-last-plugin-loop: the steps before
Build-LastPlugin.py never read Thornswood-Last.esp, and each takes that
plugin's effect from the data that decides it. The -WithoutLast box run on
16 Nov 2026 found cast.json was one: 36 more people came out in no hold
without the Last plugin, because the places it gives a hold (#2551) were
read out of the plugin, built from the build before. Build-CastTable.py now
never reads it and gives those places their hold from the list the plugin
is made from, placeHolds in game/data/last-plugin-policy.json.

This makes a small Data folder: a Skyrim.esm with a hold, a place in no
hold, a room with no location and a person standing in each, the other four
masters empty, and a Thornswood-Last.esp giving the place its parent and the
room its location, as Build-LastPlugin.py makes them. Then it holds
Build-CastTable.py to:

  1. Without Thornswood-Last.esp in the order, both people are in the hold,
     one through the place's new parent, one through the room's location.
  2. With it, the table is the same, byte for byte: the plugin is not read.
  3. A place the policy names that no plugin has stops it, writing nothing.
  4. A place the policy names that is in a hold already stops it, writing
     nothing: the list is out of date.
  5. A room the policy names that has a location of its own now stops it,
     writing nothing.
  6. Build-CastTable.py names no way into the Last plugin's records but the
     policy's placeHolds, which Build-LastPlugin.py is made from too.

Needs python only. No game, no network.
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, 'scripts', 'dev', 'Build-CastTable.py')
passed = failed = 0


def yes(what, cond):
    global passed, failed
    if cond:
        passed += 1
        print('PASS  ' + what)
    else:
        failed += 1
        print('FAIL  ' + what)


def sub(tag, body):
    return tag + struct.pack('<H', len(body)) + body


def record(tag, fid, subs):
    data = b''.join(subs)
    return tag + struct.pack('<IIIIHH', len(data), 0, fid, 0, 44, 0) + data


def grup(label, gtype, content):
    return b'GRUP' + struct.pack('<I', 24 + len(content)) + label + struct.pack('<iII', gtype, 0, 0) + content


def plugin(masters, groups):
    head = [sub(b'HEDR', struct.pack('<fII', 1.7, 0, 0x800))]
    for m in masters:
        head.append(sub(b'MAST', m.encode('ascii') + b'\0'))
        head.append(sub(b'DATA', struct.pack('<Q', 0)))
    return record(b'TES4', 0, head) + b''.join(groups)


def edid(s):
    return sub(b'EDID', s.encode('ascii') + b'\0')


def fids(*xs):
    return b''.join(struct.pack('<I', x) for x in xs)


KW_HOLD, KW_NPC = 0x10, 0x11
HOLD, PLACE, OWNER = 0x20, 0x21, 0x22
RACE, PERSON = 0x30, 0x40
PLACE_CELL, ROOM = 0x50, 0x51
IN_PLACE, IN_ROOM = 0x60, 0x61


def location(fid, name, parent=None, keywords=()):
    subs = [edid(name)]
    if keywords:
        subs.append(sub(b'KWDA', fids(*keywords)))
    if parent is not None:
        subs.append(sub(b'PNAM', fids(parent)))
    return record(b'LCTN', fid, subs)


def cell(fid, name, loc=None):
    subs = [edid(name), sub(b'DATA', b'\x01\x00')]
    if loc is not None:
        subs.append(sub(b'XLCN', fids(loc)))
    return record(b'CELL', fid, subs)


def standing(fid):
    return record(b'ACHR', fid, [sub(b'NAME', fids(PERSON)), sub(b'DATA', b'\0' * 24)])


def skyrim():
    kywd = grup(b'KYWD', 0, record(b'KYWD', KW_HOLD, [edid('LocTypeHold')]) +
                record(b'KYWD', KW_NPC, [edid('ActorTypeNPC')]))
    lctn = grup(b'LCTN', 0, location(HOLD, 'TestHoldLocation', keywords=(KW_HOLD,)) +
                location(PLACE, 'TestPlaceLocation') + location(OWNER, 'TestOwnerLocation', HOLD))
    race = grup(b'RACE', 0, record(b'RACE', RACE, [edid('NordRace'), sub(b'KWDA', fids(KW_NPC))]))
    npc = grup(b'NPC_', 0, record(b'NPC_', PERSON, [edid('TestPerson'), sub(b'ACBS', b'\0' * 24),
                                                     sub(b'RNAM', fids(RACE))]))
    cells = grup(b'CELL', 0,
                 cell(PLACE_CELL, 'TestPlaceCell', PLACE) +
                 grup(fids(PLACE_CELL), 6, standing(IN_PLACE)) +
                 cell(ROOM, 'TestRoom') +
                 grup(fids(ROOM), 6, standing(IN_ROOM)))
    return plugin([], [kywd, lctn, race, npc, cells])


def last():
    # As Build-LastPlugin.py makes it: the place copied with its new parent,
    # the room copied with its new location.
    return plugin(['Skyrim.esm'], [grup(b'CELL', 0, cell(ROOM, 'TestRoom', OWNER)),
                                   grup(b'LCTN', 0, location(PLACE, 'TestPlaceLocation', HOLD))])


def d(fid):
    return '%x:Skyrim.esm' % fid


def loc_row(fid, name, parent, parent_name):
    return {'location': d(fid), 'edid': name, 'place': name, 'parent': d(parent),
            'parentEdid': parent_name, 'holdEdid': 'TestHoldLocation'}


def cell_row(fid, name, loc, loc_name):
    return {'cell': d(fid), 'edid': name, 'place': name, 'location': d(loc),
            'locationEdid': loc_name, 'holdEdid': 'TestHoldLocation'}


GOOD = {'placeHolds': {'locations': [loc_row(PLACE, 'TestPlaceLocation', HOLD, 'TestHoldLocation')],
                       'cells': [cell_row(ROOM, 'TestRoom', OWNER, 'TestOwnerLocation')]}}


def run(tmp, with_last, policy):
    pol = os.path.join(tmp, 'policy.json')
    with open(pol, 'w') as fh:
        json.dump(policy, fh)
    txt = os.path.join(tmp, 'plugins.txt')
    with open(txt, 'w') as fh:
        fh.write(('*Thornswood-Last.esp\n' if with_last else '') + '\n')
    out = os.path.join(tmp, 'cast.json')
    if os.path.exists(out):
        os.remove(out)
    r = subprocess.run([sys.executable, TOOL, '--data', os.path.join(tmp, 'Data'), '--plugins', txt,
                        '--out', out, '--policy', pol], capture_output=True, text=True)
    doc = None
    if os.path.exists(out):
        with open(out, encoding='utf-8') as fh:
            doc = fh.read()
    return r.returncode, r.stdout + r.stderr, doc


tmp = tempfile.mkdtemp(prefix='tw-5191-cast-')
try:
    data = os.path.join(tmp, 'Data')
    os.makedirs(data)
    with open(os.path.join(data, 'Skyrim.esm'), 'wb') as fh:
        fh.write(skyrim())
    for m in ('Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'):
        with open(os.path.join(data, m), 'wb') as fh:
            fh.write(plugin([], []))
    with open(os.path.join(data, 'Thornswood-Last.esp'), 'wb') as fh:
        fh.write(last())

    code, said, without = run(tmp, False, GOOD)
    if code != 0:
        print(said)
    doc = json.loads(without) if without else {}
    hold = doc.get('holds', {}).get('TestHoldLocation', {})
    yes('1 without Thornswood-Last.esp the builder runs and says it gave the places their hold',
        code == 0 and '1 location(s) and 1 room(s) given their hold from placeHolds' in said)
    yes('1   and both people are in the hold, nobody in no hold',
        hold.get('counts', {}).get('people') == 2 and doc.get('counts', {}).get('noHold') == 0)
    yes('1   one through the place\'s new parent, one through the room\'s location',
        doc.get('holdFrom') == {'the cell it stands in': 2})

    code, said, withlast = run(tmp, True, GOOD)
    if code != 0:
        print(said)
    yes('2 with Thornswood-Last.esp in the order the table is the same, byte for byte',
        code == 0 and without is not None and withlast == without)

    gone = json.loads(json.dumps(GOOD))
    gone['placeHolds']['locations'].append(loc_row(0xabcde, 'GoneLocation', HOLD, 'TestHoldLocation'))
    code, said, out = run(tmp, False, gone)
    yes('3 a place no plugin has stops it and writes nothing',
        code == 1 and 'STOP. the policy gives abcde:Skyrim.esm (GoneLocation) a hold, and no plugin has that location'
        in said and out is None)

    held = json.loads(json.dumps(GOOD))
    held['placeHolds']['locations'].append(loc_row(OWNER, 'TestOwnerLocation', HOLD, 'TestHoldLocation'))
    for with_last in (False, True):
        code, said, out = run(tmp, with_last, held)
        yes('4 a place already in a hold stops it and writes nothing, %s Thornswood-Last.esp'
            % ('with' if with_last else 'without'),
            code == 1 and 'TestOwnerLocation is in TestHoldLocation already' in said and out is None)

    own = json.loads(json.dumps(GOOD))
    own['placeHolds']['cells'].append(cell_row(PLACE_CELL, 'TestPlaceCell', OWNER, 'TestOwnerLocation'))
    code, said, out = run(tmp, False, own)
    yes('5 a room with a location of its own now stops it and writes nothing',
        code == 1 and 'has a location of its own now' in said and out is None)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

with open(TOOL, encoding='utf-8') as fh:
    src = fh.read()
yes('6 Build-CastTable.py leaves Thornswood-Last.esp out of the order and reads placeHolds',
    "if n.lower() != LAST_PLUGIN.lower()" in src and ".get('placeHolds')" in src
    and 'name == LAST_PLUGIN' not in src)
with open(os.path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py'), encoding='utf-8') as fh:
    last_tool = fh.read()
yes('6 Build-LastPlugin.py makes its places from the same placeHolds',
    "policy.get('placeHolds')" in last_tool)

print('')
print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
