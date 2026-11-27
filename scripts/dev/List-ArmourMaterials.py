"""
List-ArmourMaterials.py

Read only. Lists every armour piece a recipe of the load order makes that the
crafting menu puts under its Armour header but in no material group, with
the keywords the piece carries, the bench its recipe is made at and what the
recipe takes. Writes nothing.

WHY (#4650). The crafting menu (Constructible Object Custom Keyword System,
our config game/ours/Data/SKSE/Plugins/CraftingCategories/
Thornswood-Content.json, #3133) puts a piece under the Armour header by its
ArmorHeavy, ArmorLight or ArmorShield keyword, and in a material group by a
material keyword the config names. A piece with no such keyword sits under
the header in no group, where nobody scrolling the groups finds it. On 30
Oct that was 49 Immersive Armors pieces, 22 Playable Rieklings pieces and
Skyrim's hold guard armour, read on One from the mods' files. Which material
each should be filed under is read from these records, so this lists them,
measured on the box where the plugins are:

    pwsh scripts/vps/Box-Run.ps1 -Line 'List-GameData -Lister ArmourMaterials'

    pwsh scripts/mods/Run-OnBox.ps1 scripts/dev/List-ArmourMaterials.py --data '{data}' --plugins '{plugins}'

Each record is the one that wins in the load order. A line per piece:
ARMO, its form id, editor id and name, the header keyword, every keyword it
carries (by editor id), then its recipes, each with its form id, editor id,
bench keyword and inputs. It ends with how many pieces each group holds,
and the pieces two groups both claim, since the menu files one of those by
an order this does not know.
"""

import argparse
import importlib.util
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bsa  # noqa: E402
import own_plugins  # noqa: E402
_spec = importlib.util.spec_from_file_location('doortable', os.path.join(HERE, 'Build-DoorTable.py'))
dt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dt)

CATEGORIES = os.path.join(HERE, '..', '..', 'game', 'ours', 'Data', 'SKSE', 'Plugins',
                          'CraftingCategories', 'Thornswood-Content.json')
SECTION = '$TW_ARMOUR'
# What is read of each kind of record. The inputs' names come from the
# records that hold them.
TOPS = (b'ARMO', b'COBJ', b'KYWD', b'MISC', b'INGR', b'SLGM', b'ALCH', b'WEAP', b'AMMO')


def walk(pl, recs):
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
                    desc = pl.desc(fid)
                    if desc:
                        row = {'type': tag.decode(), 'desc': desc, 'plugin': pl.name}
                        inputs = []
                        for st, body in dt.subrecords(pl.data(q, rsize, flags)):
                            if st == b'EDID':
                                row['edid'] = body.rstrip(bytes([0])).decode('ascii', 'replace')
                            elif st == b'FULL':
                                row['name'] = pl.text(body)
                            elif st == b'KWDA' and tag == b'ARMO':
                                row['keywords'] = [pl.desc(struct.unpack_from('<I', body, i)[0])
                                                   for i in range(0, len(body) - 3, 4)]
                            elif st == b'CNAM' and tag == b'COBJ' and len(body) >= 4:
                                row['out'] = pl.desc(struct.unpack_from('<I', body, 0)[0])
                            elif st == b'BNAM' and tag == b'COBJ' and len(body) >= 4:
                                row['bench'] = pl.desc(struct.unpack_from('<I', body, 0)[0])
                            elif st == b'CNTO' and tag == b'COBJ' and len(body) >= 8:
                                item, count = struct.unpack_from('<Ii', body, 0)
                                inputs.append((pl.desc(item), count))
                        if tag == b'COBJ':
                            row['inputs'] = inputs
                        recs[desc] = row
                q += 24 + rsize
        p += size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=r'C:\Thornswood\Game\Data')
    ap.add_argument('--plugins', default='', help="the game's plugin list (plugins.txt); the five masters alone without it")
    ap.add_argument('--categories', default=CATEGORIES)
    args = ap.parse_args()

    with open(args.categories, encoding='utf-8') as fh:
        config = json.load(fh)
    header = set(config['sections'][SECTION]['keywords'])
    groups = {}
    for name, cat in config['categories'].items():
        if cat.get('section') == SECTION:
            for kw in cat['keywords']:
                groups.setdefault(kw.lower(), []).append(name)

    order = own_plugins.load_order(args.plugins) if args.plugins else list(own_plugins.MASTERS)
    recs = {}
    for name in order:
        path = own_plugins.plugin_path(args.data, name)
        if not os.path.isfile(path):
            print('STOP. %s is not in %s' % (name, args.data))
            return 1
        try:
            pl = dt.Plugin(path, name)
            if pl.localised:
                pl.strings = bsa.load_strings(args.data, name)
            walk(pl, recs)
        except own_plugins.Unreadable as exc:
            print('STOP. %s' % exc)
            return 1
    print('read %d plugins of the load order' % len(order))

    edid = lambda d: (recs.get(d) or {}).get('edid', d or '?')
    made = {}
    for r in recs.values():
        if r['type'] == 'COBJ' and r.get('out') and (recs.get(r['out']) or {}).get('type') == 'ARMO':
            made.setdefault(r['out'], []).append(r)

    counts, none, both = {}, [], []
    for out in sorted(made, key=lambda d: (recs[d]['plugin'], recs[d].get('edid', ''))):
        armo = recs[out]
        kws = [edid(k) for k in armo.get('keywords', [])]
        heads = [k for k in kws if k in header]
        if not heads:
            continue
        mine = sorted(set(g for k in kws for g in groups.get(k.lower(), [])))
        for g in mine:
            counts[g] = counts.get(g, 0) + 1
        if len(mine) > 1:
            both.append((armo, mine))
        if mine:
            continue
        none.append(armo)
        print('ARMO %-34s %-40s %-36s %s keywords %s' % (
            out, armo.get('edid', ''), armo.get('name', ''), '/'.join(heads), ' '.join(kws)))
        for c in made[out]:
            print('     COBJ %-30s %-40s at %-34s takes %s' % (
                c['desc'], c.get('edid', ''), edid(c.get('bench')),
                ', '.join('%d %s (%s)' % (n, (recs.get(i) or {}).get('name') or edid(i), i)
                          for i, n in c['inputs'])))
    print('%d armour pieces a recipe makes are under the Armour header in no group' % len(none))
    byplugin = {}
    for a in none:
        byplugin[a['plugin']] = byplugin.get(a['plugin'], 0) + 1
    for p in sorted(byplugin):
        print('  %4d from %s' % (byplugin[p], p))
    print('pieces in each group:')
    for g in sorted(counts):
        print('  %4d %s' % (counts[g], g))
    print('%d pieces two groups both claim' % len(both))
    for armo, mine in both:
        print('  %s %s: %s' % (armo['desc'], armo.get('edid', ''), ', '.join(mine)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
