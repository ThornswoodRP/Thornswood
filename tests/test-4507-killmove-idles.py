"""
tests/test-4507-killmove-idles.py

    python3 tests/test-4507-killmove-idles.py

#4507. scripts/dev/List-KillMoveIdles.py reads which paired idles are
killmoves out of Skyrim's masters, with their parents and their conditions,
for the server to judge a killmove by. This builds five small masters, one
holding an idle tree with a killmove under a killmove group and an idle that
is not one, runs the script on them and holds its output to what is in them.
"""

import os
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SCRIPT = os.path.join(ROOT, 'scripts', 'dev', 'List-KillMoveIdles.py')

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


def rec(tag, fid, body):
    return tag + struct.pack('<IIIII', len(body), 0, fid, 0, 0) + body


def grup(label, body):
    return b'GRUP' + struct.pack('<I', 24 + len(body)) + label + struct.pack('<iHHI', 0, 0, 0, 0) + body


def ctda(op, value, function, p1=0, run_on=0):
    return struct.pack('<B3xfH2xIIIIi', op << 5, value, function, p1, 0, run_on, 0, -1)


def idle(fid, edid, event, parent, conditions=()):
    body = sub(b'EDID', edid.encode() + bytes([0]))
    for c in conditions:
        body += sub(b'CTDA', c)
    body += sub(b'DNAM', b'Actors\\Character\\DefaultMale.hkx' + bytes([0]))
    body += sub(b'ENAM', event.encode() + bytes([0]))
    body += sub(b'ANAM', struct.pack('<II', parent, 0))
    return rec(b'IDLE', fid, body)


def plugin(groups=b''):
    return rec(b'TES4', 0, sub(b'HEDR', struct.pack('<fiI', 1.7, 0, 0x800))) + groups


work = tempfile.mkdtemp(prefix='thornswood-4507-')
try:
    tree = (idle(0x801, 'KillMoveRoot', '', 0, [ctda(0, 1.0, 286)]) +
            idle(0x802, 'pa_KillMove1HMDecapSlash', 'KillMove1HMDecapSlash', 0x801,
                 [ctda(0, 1.0, 597, p1=0), ctda(1, 0.0, 69, p1=0x13746, run_on=1)]) +
            idle(0x803, 'IdleWave', 'IdleWave', 0))
    with open(os.path.join(work, 'Skyrim.esm'), 'wb') as fh:
        fh.write(plugin(grup(b'IDLE', tree)))
    for name in ('Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'):
        with open(os.path.join(work, name), 'wb') as fh:
            fh.write(plugin())

    run = subprocess.run([sys.executable, SCRIPT, '--data', work], capture_output=True, text=True)
    out = run.stdout
    print(out)
    if run.stderr:
        print(run.stderr)
    yes('it ends 0', run.returncode == 0)
    yes('the killmove is listed with its event',
        'IDLE 802:Skyrim.esm pa_KillMove1HMDecapSlash event KillMove1HMDecapSlash' in out)
    yes('with its parent', 'parents 801:Skyrim.esm KillMoveRoot' in out)
    yes('with its conditions as stored, on the subject and on the target',
        'if fn 597 == 1 p1 00000000 p2 00000000 on subject' in out and
        'if fn 69 != 0 p1 00013746 p2 00000000 on target' in out)
    yes('a killmove group is listed with its own conditions',
        'IDLE 801:Skyrim.esm KillMoveRoot' in out and 'if fn 286 == 1' in out)
    yes('an idle that is not a killmove is not', 'IdleWave' not in out)
    yes('the count says what was read', '2 killmove idles, 3 idles read' in out)

    os.remove(os.path.join(work, 'Dragonborn.esm'))
    run = subprocess.run([sys.executable, SCRIPT, '--data', work], capture_output=True, text=True)
    yes('a master missing stops it', run.returncode == 1 and 'STOP. Dragonborn.esm' in run.stdout)
finally:
    shutil.rmtree(work, ignore_errors=True)

print('\n%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
