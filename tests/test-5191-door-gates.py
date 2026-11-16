"""
test-5191-door-gates.py

    python tests/test-5191-door-gates.py

#5191, stage 4e, Patrick's B on q-5191-last-plugin-loop: the steps before
Build-LastPlugin.py never read Thornswood-Last.esp, and each takes that
plugin's effect from the data that decides it. The -WithoutLast box run on
16 Nov 2026 found doors.json was one: the three town gates (#2484) were
unlocked in the table only because the Last plugin, built from the build
before, carries them without their lock. Build-DoorTable.py now writes them
unlocked from the list the Last plugin is made from, gatesUnlocked in
game/data/last-plugin-policy.json.

This makes a small Data folder: a Skyrim.esm placing the three gates and
two other doors in one cell, each locked but one, the other four masters
empty, and a Thornswood-Last.esp carrying the gates without their lock.
Then it holds Build-DoorTable.py to:

  1. Without Thornswood-Last.esp in the order, the three gates are written
     with no lock, and the other locked door keeps its lock.
  2. With it, the table is the same, byte for byte: the plugin is not read.
  3. A gate the policy names that no plugin places stops it, writing nothing.
  4. A gate the policy names that another plugin already opens stops it,
     writing nothing, with or without the Last plugin in the order: the list
     is out of date.
  5. The repository's policy names the three gates, and Build-LastPlugin.py
     takes its GATES from that list and from nowhere else.

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
TOOL = os.path.join(ROOT, 'scripts', 'dev', 'Build-DoorTable.py')
POLICY = os.path.join(ROOT, 'game', 'data', 'last-plugin-policy.json')
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


GATES = (0x1B1F1, 0x42284, 0x42286)
OTHER_LOCKED, OTHER_OPEN = 0x7777, 0x7778
DOOR_BASE, CELL, FAR = 0x100, 0x500, 0x9000


def door_ref(fid, top, locked):
    subs = [sub(b'NAME', struct.pack('<I', top | DOOR_BASE)),
            sub(b'XTEL', struct.pack('<I', top | FAR) + b'\0' * 28)]
    if locked:
        subs.append(sub(b'XLOC', struct.pack('<B3xI', 255, 0) + b'\0' * 12))
    subs.append(sub(b'DATA', b'\0' * 24))
    return record(b'REFR', top | fid, subs)


def cell_group(top, refs):
    cell = record(b'CELL', top | CELL, [sub(b'EDID', b'TestCell\0'), sub(b'DATA', b'\x00\x00')])
    return grup(b'CELL', 0, cell + grup(struct.pack('<I', top | CELL), 6, b''.join(refs)))


def skyrim():
    door = grup(b'DOOR', 0, record(b'DOOR', DOOR_BASE, [sub(b'EDID', b'TestDoor\0')]))
    refs = [door_ref(g, 0, True) for g in GATES]
    refs += [door_ref(OTHER_LOCKED, 0, True), door_ref(OTHER_OPEN, 0, False), door_ref(FAR, 0, False)]
    return plugin([], [door, cell_group(0, refs)])


def last():
    # Its masters are Skyrim.esm, so index 0 in its form ids is Skyrim.esm.
    return plugin(['Skyrim.esm'], [cell_group(0, [door_ref(g, 0, False) for g in GATES])])


def gates_policy(gates):
    return {'gatesUnlocked': {'gates': gates}}


def run(tmp, with_last, policy):
    data = os.path.join(tmp, 'Data')
    pol = os.path.join(tmp, 'policy.json')
    with open(pol, 'w') as fh:
        json.dump(policy, fh)
    lines = ['*Thornswood-Last.esp'] if with_last else []
    txt = os.path.join(tmp, 'plugins.txt')
    with open(txt, 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
    out = os.path.join(tmp, 'doors.json')
    tables = os.path.join(tmp, 'tables')
    for p in (out,):
        if os.path.exists(p):
            os.remove(p)
    shutil.rmtree(tables, ignore_errors=True)
    os.makedirs(tables)
    r = subprocess.run([sys.executable, TOOL, '--data', data, '--plugins', txt, '--out', out,
                        '--tables', tables, '--policy', pol], capture_output=True, text=True)
    doc = open(out, encoding='utf-8').read() if os.path.exists(out) else None
    return r.returncode, r.stdout + r.stderr, doc


tmp = tempfile.mkdtemp(prefix='tw-5191-gates-')
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
    names = ['%x:Skyrim.esm' % g for g in GATES]
    policy = gates_policy(names)

    code, said, without = run(tmp, False, policy)
    if code != 0:
        print(said)
    doors = json.loads(without).get('doors', {}) if without else {}
    yes('1 without Thornswood-Last.esp the builder runs and says it opened the three gates',
        code == 0 and '3 of 3 unlocked from gatesUnlocked' in said)
    yes('1   and writes each gate with no lock', all(n in doors and 'lock' not in doors[n] for n in names))
    yes('1   and the other locked door keeps its lock',
        doors.get('%x:Skyrim.esm' % OTHER_LOCKED, {}).get('lock', {}).get('level') == 255)

    code, said, withlast = run(tmp, True, policy)
    if code != 0:
        print(said)
    yes('2 with Thornswood-Last.esp in the order the table is the same, byte for byte',
        code == 0 and withlast is not None and without is not None and withlast == without)

    code, said, doc = run(tmp, False, gates_policy(names + ['abcde:Skyrim.esm']))
    yes('3 a gate no plugin places stops it and writes nothing',
        code == 1 and 'STOP. no plugin places the town gate abcde:Skyrim.esm' in said and doc is None)

    for with_last in (False, True):
        code, said, doc = run(tmp, with_last, gates_policy(names + ['%x:Skyrim.esm' % OTHER_OPEN]))
        yes('4 a gate another plugin already opens stops it and writes nothing, %s Thornswood-Last.esp'
            % ('with' if with_last else 'without'),
            code == 1 and 'already has no lock; take it off gatesUnlocked' in said and doc is None)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

real = json.load(open(POLICY, encoding='utf-8'))
yes('5 the repository\'s policy names the three town gates (#2484)',
    real.get('gatesUnlocked', {}).get('gates') == ['1b1f1:Skyrim.esm', '42284:Skyrim.esm', '42286:Skyrim.esm'])
last_tool = open(os.path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py'), encoding='utf-8').read()
yes('5 Build-LastPlugin.py takes GATES from the policy\'s list and spells none of its own',
    'GATES = policy_gates(json.load(open(POLICY' in last_tool and '0x01B1F1' not in last_tool)

print('')
print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
