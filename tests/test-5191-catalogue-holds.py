"""
test-5191-catalogue-holds.py

    python tests/test-5191-catalogue-holds.py

#5191, stage 4e, Patrick's B on q-5191-last-plugin-loop: the steps before
Build-LastPlugin.py never read Thornswood-Last.esp, and each takes that
plugin's effect from the data that decides it. The NPC catalogue,
game/data/npc-population.json, is one of them: Build-LastPlugin.py switches
off every actor it cuts, and the box's build makes it ahead of the chain
(Build-ContentOnBox.ps1), when the only Last plugin in its folder is the
server's, from the build before. It read the places that plugin gives a hold
(#2551) out of it. Build-NpcPopulation.py now reads none of its records and
gives those places their hold from the list the plugin is made from,
placeHolds in game/data/last-plugin-policy.json, as Build-CastTable.py does.

This makes the small Data folder test-5191-cast-holds.py makes: a hold, a
place in no hold, a room with no location and a person in each, and a
Thornswood-Last.esp giving the place its parent and the room its location.
Then it holds Build-NpcPopulation.py's build() to:

  1. Without Thornswood-Last.esp in the order, both people are in the hold,
     one through the place's new parent, one through the room's location.
  2. With it last in the order, the catalogue is the same but for the load
     order's last row, which names the plugin and the bytes in the folder.
  3. With a Last plugin that gives no place a hold, still the same: none of
     its records is read.
  4. A place the policy names that no plugin has stops it.
  5. The builder names no way into the Last plugin's records.

And Build-ResourceLocations.py, which reads the Last plugin as it is (it
switches placed things off), is a step of the chain after the catalogue,
not a run ahead of it:

  6. In a copy of the repository's builders, --data reads the catalogue's
     own order out of the folder and writes resource-locations.json in it.
  7. When the folder's Last plugin is not the one the catalogue holds, it
     stops: it reads the plugin the chain made, never another build's.
  8. content-tables.json runs it after Build-NpcPopulation.py, which runs
     after Build-LastPlugin.py, and Build-ContentOnBox.ps1 no longer runs it
     ahead of the chain.

Needs python only. No game, no network.
"""
import hashlib
import importlib.util
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, 'scripts', 'dev', 'Build-NpcPopulation.py')
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


def bare_last():
    # A Last plugin that gives no place a hold: what a catalogue reading its
    # records would see from another build's plugin.
    return plugin(['Skyrim.esm'], [])


MASTERS = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']

sys.path.insert(0, os.path.join(ROOT, 'scripts', 'dev'))
spec = importlib.util.spec_from_file_location('npc_population', TOOL)
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)


def catalogue(data, pol, with_last):
    names = MASTERS + (['Thornswood-Last.esp'] if with_last else [])
    habitats = pol + '.habitats.json'
    with open(habitats, 'w', encoding='utf-8') as source:
        json.dump({'version':1,'places':[]}, source)
    try:
        return P.build([os.path.join(data, n) for n in names], None, pol, habitats), ''
    except SystemExit as stop:
        return None, str(stop)


def but_order(doc):
    return dict((k, v) for k, v in doc.items() if k != 'loadOrder')


tmp = tempfile.mkdtemp(prefix='tw-5191-catalogue-')
try:
    data = os.path.join(tmp, 'Data')
    os.makedirs(data)
    with open(os.path.join(data, 'Skyrim.esm'), 'wb') as fh:
        fh.write(skyrim())
    for m in MASTERS[1:]:
        with open(os.path.join(data, m), 'wb') as fh:
            fh.write(plugin([], []))
    last_path = os.path.join(data, 'Thornswood-Last.esp')
    with open(last_path, 'wb') as fh:
        fh.write(last())
    pol = os.path.join(tmp, 'policy.json')
    with open(pol, 'w') as fh:
        json.dump(GOOD, fh)

    without, said = catalogue(data, pol, False)
    people = (without or {}).get('npcs', [])
    yes('1 without Thornswood-Last.esp the catalogue is built', without is not None and not said)
    yes('1   and both people are in the hold, one through the place\'s parent, one through the room\'s location',
        len(people) == 2 and all(r.get('hold') == 'TestHoldLocation' for r in people)
        and sorted(r.get('locationName') for r in people) == ['TestPlaceCell', 'TestRoom'])

    withlast, said = catalogue(data, pol, True)
    with open(last_path, 'rb') as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    yes('2 with it last in the order the catalogue is the same but for the load order',
        withlast is not None and without is not None and but_order(withlast) == but_order(without))
    yes('2   whose last row names the plugin and the bytes in the folder',
        withlast is not None and withlast['loadOrder'][:-1] == without['loadOrder']
        and withlast['loadOrder'][-1] == {'name': 'Thornswood-Last.esp', 'sha256': sha})

    with open(last_path, 'wb') as fh:
        fh.write(bare_last())
    bare, said = catalogue(data, pol, True)
    yes('3 a Last plugin that gives no place a hold changes nothing but its row: none of its records is read',
        bare is not None and without is not None and but_order(bare) == but_order(without))

    # 6 and 7: a copy of the builders, with the catalogue just built from
    # the folder whose Last plugin is the one that gives the places a hold.
    with open(last_path, 'wb') as fh:
        fh.write(last())
    built, said = catalogue(data, pol, True)
    root = os.path.join(tmp, 'repo')
    shutil.copytree(os.path.join(ROOT, 'scripts', 'dev'), os.path.join(root, 'scripts', 'dev'),
                    ignore=shutil.ignore_patterns('__pycache__'))
    for rel, doc in (('game/data/npc-population.json', built), ('game/data/hunts.json', {'hunts': {}}),
                     ('game/data/waters.json', {'where': {}, 'waters': {}}),
                     ('game/gamemode-tables/FISH_BY_BASE.json', {}), ('game/gamemode-tables/GAME_BY_BASE.json', {})):
        os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
        with open(os.path.join(root, rel), 'w', encoding='utf-8') as fh:
            json.dump(doc, fh)
    os.makedirs(os.path.join(root, 'docs'))
    places = os.path.join(root, 'game', 'data', 'resource-locations.json')

    def resources():
        if os.path.exists(places):
            os.remove(places)
        r = subprocess.run([sys.executable, os.path.join(root, 'scripts', 'dev', 'Build-ResourceLocations.py'),
                            '--data', data], capture_output=True, text=True, cwd=root)
        doc = None
        if os.path.exists(places):
            with open(places, encoding='utf-8') as fh:
                doc = json.load(fh)
        return r.returncode, r.stdout + r.stderr, doc

    code, said, doc = resources()
    if code != 0:
        print(said)
    yes('6 Build-ResourceLocations.py --data reads the catalogue\'s order out of the folder and writes its table',
        code == 0 and doc is not None and doc.get('loadOrder') == built['loadOrder'])
    with open(last_path, 'wb') as fh:
        fh.write(bare_last())
    code, said, doc = resources()
    yes('7 with another Last plugin in the folder than the catalogue holds, it stops and writes nothing',
        code != 0 and 'Resource plugin changed: Thornswood-Last.esp' in said and doc is None)
    with open(last_path, 'wb') as fh:
        fh.write(last())

    gone = json.loads(json.dumps(GOOD))
    gone['placeHolds']['locations'].append(loc_row(0xabcde, 'GoneLocation', HOLD, 'TestHoldLocation'))
    with open(pol, 'w') as fh:
        json.dump(gone, fh)
    out, said = catalogue(data, pol, False)
    yes('4 a place the policy names that no plugin has stops it',
        out is None and said.startswith('STOP. the policy gives abcde:Skyrim.esm (GoneLocation) a hold, and no plugin has that location'))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

with open(TOOL, encoding='utf-8') as fh:
    src = fh.read()
at = src.index('if name.lower() == LAST_PLUGIN.lower():')
yes('5 the builder hashes the Last plugin and goes on to the next, reading none of its records',
    src[at:].split('\n')[2].strip() == 'continue' and 'C.read(plugin, places)' not in src)

with open(os.path.join(ROOT, 'scripts', 'mods', 'content-tables.json'), encoding='utf-8') as fh:
    tools = [step['tool'] for step in json.load(fh)['steps']]


def at(tool):
    return tools.index(tool) if tool in tools else -1


yes('8 the chain runs Build-ResourceLocations.py after the catalogue, which runs after Build-LastPlugin.py',
    0 <= at('scripts/mods/Build-LastPlugin.py') < at('scripts/dev/Build-NpcPopulation.py')
    < at('scripts/dev/Build-ResourceLocations.py'))
with open(os.path.join(ROOT, 'scripts', 'mods', 'Build-ContentOnBox.ps1'), encoding='utf-8') as fh:
    box = fh.read()
yes('8   and the box\'s build no longer runs it ahead of the chain',
    "Invoke-Step 'scripts/dev/Build-ResourceLocations.py'" not in box)

print('')
print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
