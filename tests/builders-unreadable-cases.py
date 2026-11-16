"""
builders-unreadable-cases.py, run by game\\tests\\test-4553-builders-unreadable.js

#4553. Build-BenchTable, Build-CastTable, Build-DoorTable, Build-CrimeTable,
Build-JailTable, Build-WellTable and Build-AdminNameTables checked that each
plugin of the load order was in Data, then passed over a file that did not
open as a plugin and carried on, and a compressed record that would not
inflate was read as an empty one (the bench builder passed over every
compressed record without reading it). With the masters swapped for blank
files they built empty tables, wrote them, and exited 0.

This makes a Data folder of five small masters and runs each builder on two
load orders: one with a plugin that is an empty file, and one with a plugin
whose header is sound and whose records, one in each group these builders
read, are compressed and will not inflate. Each builder must stop, say STOP
naming that plugin and why, exit 1, and write nothing: no gamemode table, no
data file. Nothing outside a temporary folder is read or written.
"""

import io
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DEV = os.path.join(ROOT, 'scripts', 'dev')

COMPRESSED = 0x00040000

passed = failed = 0


def yes(what, cond):
    global passed, failed
    print(('PASS  ' if cond else 'FAIL  ') + what)
    if cond:
        passed += 1
    else:
        failed += 1


def sub(tag, body):
    return tag + struct.pack('<H', len(body)) + body


def rec(tag, fid, body, flags=0):
    return tag + struct.pack('<IIIII', len(body), flags, fid, 0, 0) + body


def grup(label, body):
    return b'GRUP' + struct.pack('<I', 24 + len(body)) + label + struct.pack('<iHHI', 0, 0, 0, 0) + body


def plugin(groups=b''):
    return rec(b'TES4', 0, sub(b'HEDR', struct.pack('<fiI', 1.7, 0, 0x800))) + groups


# A compressed record says how long it inflates to, then holds a zlib stream.
# These say 64 bytes and hold bytes that are no zlib stream at all, one in
# each group a builder here reads.
NOT_ZLIB = struct.pack('<I', 64) + b'these bytes are not a zlib stream'
BROKEN_GROUPS = b''.join(grup(t, rec(t, 0x801, NOT_ZLIB, COMPRESSED))
                         for t in (b'FURN', b'STAT', b'NPC_', b'CELL', b'FACT'))

MASTERS = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']


def runs(data, lst, recipes):
    """(what, arguments, a fresh folder for its writes) for each run.

    Each builder runs with --check where it has one, and writing where its
    writes can all be pointed into the folder. Build-WellTable has no
    --tables, so it runs with --check alone; Build-CrimeTable writes only
    with its scripts, so it runs with --check --json; Build-AdminNameTables
    has no --check."""
    base = ['--data', data, '--plugins', lst]
    plan = [
        ('Build-BenchTable.py --check', ['Build-BenchTable.py', '--recipes', recipes, '--tables', '{T}', '--check']),
        ('Build-BenchTable.py', ['Build-BenchTable.py', '--recipes', recipes, '--tables', '{T}']),
        ('Build-CastTable.py --check', ['Build-CastTable.py', '--out', '{F}', '--check']),
        ('Build-CastTable.py', ['Build-CastTable.py', '--out', '{F}']),
        ('Build-DoorTable.py --check', ['Build-DoorTable.py', '--out', '{F}', '--tables', '{T}', '--check']),
        ('Build-DoorTable.py', ['Build-DoorTable.py', '--out', '{F}', '--tables', '{T}']),
        ('Build-CrimeTable.py --check', ['Build-CrimeTable.py', '--json', '{F}', '--no-scripts', '--check']),
        ('Build-JailTable.py --check', ['Build-JailTable.py', '--out', '{F}', '--tables', '{T}', '--check']),
        ('Build-JailTable.py', ['Build-JailTable.py', '--out', '{F}', '--tables', '{T}']),
        ('Build-WellTable.py --check', ['Build-WellTable.py', '--out', '{F}', '--check']),
        ('Build-AdminNameTables.py', ['Build-AdminNameTables.py', '--tables', '{T}']),
    ]
    return [(what, [args[0]] + base + args[1:]) for what, args in plan]


work = tempfile.mkdtemp(prefix='thornswood-4553-')
try:
    data = os.path.join(work, 'Data')
    os.makedirs(data)
    for name in MASTERS:
        with open(os.path.join(data, name), 'wb') as fh:
            fh.write(plugin())
    with open(os.path.join(data, 'Blank.esp'), 'wb') as fh:
        fh.write(b'')
    with open(os.path.join(data, 'Broken.esp'), 'wb') as fh:
        fh.write(plugin(BROKEN_GROUPS))
    recipes = os.path.join(work, 'recipes.json')
    with io.open(recipes, 'w', encoding='utf-8') as fh:
        json.dump({'recipes': {}, 'unowned': {}}, fh)

    n = 0
    for bad, why in (('Blank.esp', 'TES4'), ('Broken.esp', 'will not inflate')):
        lst = os.path.join(work, 'plugins-' + bad + '.txt')
        with io.open(lst, 'w', encoding='utf-8') as fh:
            fh.write('*' + bad + '\r\n')
        for what, args in runs(data, lst, recipes):
            n += 1
            out = os.path.join(work, 'out-%d' % n)
            tables = os.path.join(out, 'tables')
            os.makedirs(tables)
            f = os.path.join(out, 'out.json')
            args = [tables if a == '{T}' else f if a == '{F}' else a for a in args]
            args[0] = os.path.join(DEV, args[0])
            r = subprocess.run([sys.executable] + args, capture_output=True, text=True, timeout=300)
            said = (r.stdout or '') + (r.stderr or '')
            stops = [ln for ln in said.splitlines() if ln.strip().startswith('STOP.')]
            named = [ln for ln in stops if bad in ln and why in ln]
            wrote = sorted(os.listdir(tables)) + (['out.json'] if os.path.exists(f) else [])
            yes('%s with %s: exits 1 (exit %s)' % (what, bad, r.returncode), r.returncode == 1)
            yes('  says STOP, naming %s and that it is %s' % (bad, 'not a plugin' if bad == 'Blank.esp' else 'a record that will not inflate'),
                len(named) == 1)
            yes('  and writes nothing%s' % ((' (wrote ' + ', '.join(wrote) + ')') if wrote else ''), not wrote)
            if r.returncode != 1 or len(named) != 1:
                print('    ' + '\n    '.join(said.strip().splitlines()[-6:]))
finally:
    shutil.rmtree(work, ignore_errors=True)

print('\n%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
