"""
List-KillMoveIdles.py

Read only. Lists the IDLE records of Skyrim's five masters that are
killmoves, each with its form id, editor id, animation event, behaviour
graph, its parents up the idle tree, and every condition on it and on each
parent, raw. Writes nothing.

WHY (#4507). A killmove has to play on every machine nearby, so the server
picks it and tells each one to play the pair (decided 12 Oct). Which paired
idle fits a kill (the attacker's weapon, the target's race, standing or
sneaking) is in these records' conditions, and the server has to judge by
the same ones. Skyrim's own data is on the box (Run-OnBox.ps1), so this is
measured there, not remembered:

    pwsh scripts/mods/Run-OnBox.ps1 scripts/dev/List-KillMoveIdles.py --data '{data}'

A record is listed when its editor id or animation event, or a parent's
editor id, says killmove. Each condition is printed as the game stores it
(CTDA): the function's index, the comparison and its value, the two
parameters, and what it runs on, so nothing is read into it here.
"""

import argparse
import importlib.util
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import own_plugins  # noqa: E402
_spec = importlib.util.spec_from_file_location('doortable', os.path.join(HERE, 'Build-DoorTable.py'))
dt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dt)

OPS = {0: '==', 1: '!=', 2: '>', 3: '>=', 4: '<', 5: '<='}
RUN_ON = {0: 'subject', 1: 'target', 2: 'reference', 3: 'combat target',
          4: 'linked ref', 5: 'quest alias', 6: 'package data', 7: 'event data'}


def zstring(body):
    return body.split(bytes([0]), 1)[0].decode('ascii', 'replace')


def condition(body):
    """One CTDA, as stored: 32 bytes."""
    if len(body) < 28:
        return {'raw': body.hex()}
    head = body[0]
    op = head >> 5
    flags = head & 0x1f
    if flags & 0x04:
        value = 'global %08x' % struct.unpack_from('<I', body, 4)[0]
    else:
        value = '%g' % struct.unpack_from('<f', body, 4)[0]
    function = struct.unpack_from('<H', body, 8)[0]
    p1, p2, run_on, ref = struct.unpack_from('<IIII', body, 12)
    return {
        'function': function, 'op': OPS.get(op, str(op)), 'value': value,
        'or': bool(flags & 0x01), 'p1': p1, 'p2': p2,
        'run_on': RUN_ON.get(run_on, str(run_on)), 'ref': ref,
    }


def walk(pl, out):
    buf = pl.buf
    u32 = lambda i: struct.unpack_from('<I', buf, i)[0]
    p = 24 + pl.header
    while p + 24 <= len(buf):
        size = u32(p + 4)
        if buf[p:p + 4] != b'GRUP':
            break
        if buf[p + 8:p + 12] == b'IDLE':
            q, end = p + 24, p + size
            while q + 24 <= end:
                rsize = u32(q + 4)
                tag = buf[q:q + 4]
                if tag == b'GRUP':
                    q += 24
                    continue
                if tag == b'IDLE':
                    flags, fid = struct.unpack_from('<II', buf, q + 8)
                    row = {'desc': pl.desc(fid), 'conditions': [], 'parent': None}
                    for st, body in dt.subrecords(pl.data(q, rsize, flags)):
                        if st == b'EDID':
                            row['edid'] = zstring(body)
                        elif st == b'ENAM':
                            row['event'] = zstring(body)
                        elif st == b'DNAM':
                            row['graph'] = zstring(body)
                        elif st == b'CTDA':
                            row['conditions'].append(condition(body))
                        elif st == b'ANAM' and len(body) >= 8:
                            parent, _previous = struct.unpack_from('<II', body, 0)
                            row['parent'] = pl.desc(parent) if parent else None
                    out[row['desc']] = row
                q += 24 + rsize
        p += size


def chain(rows, desc):
    seen = []
    while desc and desc in rows and desc not in seen:
        seen.append(desc)
        desc = rows[desc]['parent']
    return seen


def is_killmove(rows, desc):
    for d in chain(rows, desc):
        r = rows[d]
        if 'killmove' in r.get('edid', '').lower():
            return True
        if d == desc and 'killmove' in r.get('event', '').lower():
            return True
    return False


def show(c):
    if 'raw' in c:
        return 'raw ' + c['raw']
    return 'fn %d %s %s p1 %08x p2 %08x on %s%s%s' % (
        c['function'], c['op'], c['value'], c['p1'], c['p2'], c['run_on'],
        ' ref %08x' % c['ref'] if c['ref'] else '', ' OR' if c['or'] else '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=r'C:\Thornswood\Game\Data')
    args = ap.parse_args()

    rows = {}
    for name in own_plugins.MASTERS:
        path = own_plugins.plugin_path(args.data, name)
        if not os.path.isfile(path):
            print('STOP. %s is not in %s' % (name, args.data))
            return 1
        try:
            pl = dt.Plugin(path, name)
            walk(pl, rows)
        except own_plugins.Unreadable as exc:
            print('STOP. %s' % exc)
            return 1

    listed = [d for d in rows if is_killmove(rows, d)]
    parents = set()
    for d in sorted(listed, key=lambda k: rows[k].get('edid', '')):
        r = rows[d]
        up = chain(rows, d)[1:]
        parents.update(up)
        print('IDLE %s %s event %s graph %s' % (d, r.get('edid', ''), r.get('event', ''), r.get('graph', '')))
        print('  parents %s' % ' < '.join('%s %s' % (u, rows[u].get('edid', '')) for u in up))
        for c in r['conditions']:
            print('  if ' + show(c))
    for d in sorted(parents - set(listed), key=lambda k: rows[k].get('edid', '')):
        r = rows[d]
        print('PARENT %s %s event %s' % (d, r.get('edid', ''), r.get('event', '')))
        for c in r['conditions']:
            print('  if ' + show(c))
    print('%d killmove idles, %d idles read' % (len(listed), len(rows)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
