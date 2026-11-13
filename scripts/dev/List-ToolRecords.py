"""
List-ToolRecords.py

Read only. Lists the MISC and STAT records of Skyrim's five masters whose
editor id, name or model names a hand tool of a trade, with each one's form
id, name, model and (for a MISC) value and weight. Writes nothing.

WHY (#3162). Each bench trade needs its own tool, worn out after 50 uses like a
gathering tool (Patrick's A of 22 Oct 2026). Which item each trade's tool is
has to be one every load order holds, and a tool made as Thornswood's own
record has to wear a model that is in Skyrim's own archives, or it is drawn as
nothing. Skyrim's own data is on the box (Run-OnBox.ps1), so the answer is
measured there, not remembered:

    pwsh scripts/mods/Run-OnBox.ps1 scripts/dev/List-ToolRecords.py --data '{data}'

--models also lists every .nif path in the mesh archives that matches the same
words, so a model that no MISC or STAT uses yet is seen too.
"""

import argparse
import importlib.util
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bsa  # noqa: E402
import own_plugins  # noqa: E402
_spec = importlib.util.spec_from_file_location('doortable', os.path.join(HERE, 'Build-DoorTable.py'))
dt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dt)

WORDS = re.compile(r'hammer|tongs|anvil|bellows|needle|shear|scissor|thread|spool|spindle|'
                   r'yarn|loom|sew|tailor|awl|mortar|pestle|alembic|retort|alchem|ladle|'
                   r'spoon|knife|cleaver|chisel|saw|drawknife|draw knife|quill|ink|'
                   r'enchant|soulgem|tool|kit', re.I)
NOT = re.compile(r'warhammer|war ?axe|battleaxe|dagger|key|note|book|letter|journal|'
                 r'potion|poison|ingredient|ingot|ore\b', re.I)
TOPS = (b'MISC', b'STAT')


def walk(pl, out):
    buf = pl.buf
    u32 = lambda i: struct.unpack_from('<I', buf, i)[0]
    p = 24 + pl.header
    while p + 24 <= len(buf):
        size = u32(p + 4)
        if buf[p:p + 4] != b'GRUP':
            break
        label = buf[p + 8:p + 12]
        if label in TOPS:
            q, end = p + 24, p + size
            while q + 24 <= end:
                rsize = u32(q + 4)
                tag = buf[q:q + 4]
                if tag == label:
                    flags, fid = struct.unpack_from('<II', buf, q + 8)
                    row = {'type': tag.decode(), 'desc': pl.desc(fid)}
                    for st, body in dt.subrecords(pl.data(q, rsize, flags)):
                        if st == b'EDID':
                            row['edid'] = body.rstrip(bytes([0])).decode('ascii', 'replace')
                        elif st == b'FULL':
                            row['name'] = pl.text(body)
                        elif st == b'MODL':
                            row['model'] = body.rstrip(bytes([0])).decode('ascii', 'replace')
                        elif st == b'OBND' and len(body) >= 12:
                            row['bounds'] = struct.unpack_from('<6h', body, 0)
                        elif st == b'DATA' and tag == b'MISC' and len(body) >= 8:
                            row['value'], row['weight'] = struct.unpack_from('<If', body, 0)
                    words = ' '.join([row.get('edid', ''), row.get('name', ''), row.get('model', '')])
                    if WORDS.search(words) and not NOT.search(row.get('edid', '') + ' ' + row.get('name', '')):
                        out[row['desc']] = row
                q += 24 + rsize
        p += size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=r'C:\Thornswood\Game\Data')
    ap.add_argument('--models', action='store_true', help='also list matching .nif paths in the mesh archives')
    args = ap.parse_args()

    out = {}
    for name in own_plugins.MASTERS:
        path = own_plugins.plugin_path(args.data, name)
        if not os.path.isfile(path):
            print('STOP. %s is not in %s' % (name, args.data))
            return 1
        try:
            pl = dt.Plugin(path, name)
            if pl.localised:
                pl.strings = bsa.load_strings(args.data, name)
            walk(pl, out)
        except own_plugins.Unreadable as exc:
            print('STOP. %s' % exc)
            return 1

    for d in sorted(out, key=lambda k: (out[k]['type'], out[k].get('edid', ''))):
        r = out[d]
        extra = ''
        if r['type'] == 'MISC':
            extra = ' value %s weight %.1f' % (r.get('value'), r.get('weight') or 0)
        if r.get('bounds'):
            extra += ' bounds %s' % (r['bounds'],)
        print('%s %-28s %-40s %-30s %s%s' % (r['type'], d, r.get('edid', ''), r.get('name', ''),
                                            r.get('model', ''), extra))
    print('%d records' % len(out))

    if args.models:
        for archive in sorted(os.listdir(args.data)):
            if not (archive.lower().startswith('skyrim - meshes') or
                    archive.lower() in ('dawnguard.bsa', 'hearthfires.bsa', 'dragonborn.bsa')):
                continue
            try:
                names = bsa.names(os.path.join(args.data, archive))
            except Exception as e:  # a read that fails is said, not hidden
                print('could not read %s: %s' % (archive, e))
                continue
            for n in sorted(names):
                if n.endswith('.nif') and WORDS.search(n) and not NOT.search(n):
                    print('NIF %s %s' % (archive, n))
    return 0


if __name__ == '__main__':
    sys.exit(main())
