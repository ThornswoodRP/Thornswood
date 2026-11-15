"""Count where every harvestable plant and every ore seam is placed, by hold.

Issue #3150. Patrick, 22 Oct 2026 (page answer A): each hold has 2 to 3
hold-only plants, ores or animals, which grow only in their own hold. Which
ones is read off the load order rather than guessed: a plant or ore whose
placements already sit mostly in one hold loses the fewest when the rest are
switched off, and keeps the world looking the way its authors laid it out.

Reads the NPC catalogue's own load order (game/data/npc-population.json),
each plugin from --data, held to the bytes the catalogue was built from, the
same way scripts/dev/Build-NpcPopulation.py --data does. Every placed
reference whose base is a plant of game/data/harvests.json or a seam of
game/data/ores.json is placed in a hold by the catalogue's own rule
(Build-CastTable.py, Cast.place). Writes nothing; prints one JSON document:

    {"plants": {produce name: {"bases": n, "placed": n, "off": n,
                               "byHold": {hold: n}}}, "ores": {...}}

"placed" counts the references that start switched on; "off" the ones that
start switched off or follow an enable parent, which are not in byHold.

    python scripts/dev/Measure-HoldResources.py --data C:\\Thornswood\\Game\\Data
    pwsh scripts/mods/Run-OnBox.ps1 scripts/dev/Measure-HoldResources.py --data '{data}'
"""
import argparse
import collections
import hashlib
import importlib.util
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
spec = importlib.util.spec_from_file_location('population', HERE / 'Build-NpcPopulation.py')
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)
C = P.C
own_plugins = P.own_plugins


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True, help='A folder holding every plugin of the catalogue\'s load order')
    args = parser.parse_args()
    population = json.loads((ROOT / 'game/data/npc-population.json').read_text(encoding='utf-8'))
    harvests = json.loads((ROOT / 'game/data/harvests.json').read_text(encoding='utf-8'))['harvests']
    ores = json.loads((ROOT / 'game/data/ores.json').read_text(encoding='utf-8'))['ores']
    kinds = {}
    for base, row in harvests.items():
        kinds[base] = ('plants', row['name'])
    for base, row in ores.items():
        kinds[base] = ('ores', row['name'])
    tables = {tag: {} for tag in C.WANTED}
    tables.update({b'ACHR': {}, b'REFR': {}, b'ECZN': {}})
    try:
        for row in population['loadOrder']:
            path = own_plugins.plugin_path(args.data, row['name'])
            plugin = C.Plugin(path, row['name'])
            if not own_plugins.is_own(row['name']) and hashlib.sha256(plugin.buf).hexdigest() != row['sha256']:
                raise SystemExit('STOP. %s is not the bytes npc-population.json was built from.' % row['name'])
            if plugin.localised:
                plugin.strings = C.bsa.load_strings(args.data, plugin.name)
            C.read(plugin, tables)
            P.read_details(plugin, tables)
    except own_plugins.Unreadable as exc:
        # A plugin that is not one, or a record in it that will not inflate.
        raise SystemExit('STOP. %s.' % exc)
    context = C.Cast(tables)
    out = {'plants': {}, 'ores': {}}
    bases = collections.defaultdict(set)
    for identity, row in tables[b'REFR'].items():
        kind = kinds.get(row.get('base'))
        if not kind or row.get('deleted'):
            continue
        group, name = kind
        entry = out[group].setdefault(name, {'bases': 0, 'placed': 0, 'off': 0, 'byHold': collections.Counter()})
        bases[kind].add(row['base'])
        if context.off(identity):
            entry['off'] += 1
            continue
        position = row.get('pos') or []
        hold, _ = context.place(dict(row, pos=position[:2]), None)
        entry['placed'] += 1
        entry['byHold'][context.hold_name(hold) if hold else 'no hold'] += 1
    for (group, name), seen in bases.items():
        out[group][name]['bases'] = len(seen)
    for group in out:
        for name, entry in out[group].items():
            entry['byHold'] = dict(entry['byHold'].most_common())
        out[group] = dict(sorted(out[group].items()))
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
