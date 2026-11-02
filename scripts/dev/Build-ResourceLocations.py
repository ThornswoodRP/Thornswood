"""List source-derived fishing and hunting supply; never invent placement coordinates."""
import argparse
import collections
import csv
import importlib.util
import json
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('population', HERE / 'Build-NpcPopulation.py')
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)
C = P.C
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import gamemode_tables  # noqa: E402  (the gamemode's tables, #5191)


def js_table(name):
    """One of the gamemode's tables (game/gamemode-tables, #5191)."""
    if not os.path.isfile(gamemode_tables.table_file(name)):
        raise ValueError('Missing production table: ' + name)
    return gamemode_tables.read(name)


def write_csv(filename, rows, columns):
    with (ROOT / 'docs' / filename).open('w', encoding='utf-8', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        writer.writerows({key: row.get(key, '') for key in columns} for row in rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings')
    parser.add_argument('--strings-dir')
    parser.add_argument('--hunting-only', action='store_true',
        help='write docs/HUNTING-SPOTS.csv from npc-population.json and hunts.json, reading no plugin')
    args = parser.parse_args()
    population = json.loads((ROOT / 'game/data/npc-population.json').read_text(encoding='utf-8'))
    if args.hunting_only:
        animals = P.write_hunting_spots(population['npcs'])
        print(json.dumps({'animalPlacements': len(animals),
            'dressablePlacements': sum(bool(row['products']) for row in animals)}))
        return
    if not args.settings or not args.strings_dir:
        parser.error('--settings and --strings-dir are required, unless --hunting-only')
    settings = json.loads(pathlib.Path(args.settings).read_text(encoding='utf-8-sig'))
    paths = settings['loadOrder']
    order = [pathlib.Path(path).name for path in paths]
    if order != [row['name'] for row in population['loadOrder']]:
        raise ValueError('Resource locations and population use different plugin orders')
    tables = {tag: {} for tag in C.WANTED}
    tables.update({b'ACHR': {}, b'REFR': {}, b'ECZN': {}})
    for path, provenance in zip(paths, population['loadOrder']):
        plugin = C.Plugin(path, pathlib.Path(path).name)
        if P.hashlib.sha256(plugin.buf).hexdigest() != provenance['sha256']:
            raise ValueError('Resource plugin changed: ' + provenance['name'])
        if plugin.localised:
            plugin.strings = C.bsa.load_strings(args.strings_dir, plugin.name)
        C.read(plugin, tables)
        P.read_details(plugin, tables)
        if plugin.failed:
            raise ValueError('Failed compressed records: ' + plugin.name)
    context = C.Cast(tables)
    fish = js_table('FISH_BY_BASE')
    racks = js_table('GAME_BY_BASE')
    waters = json.loads((ROOT / 'game/data/waters.json').read_text(encoding='utf-8'))
    catches, hanging = [], []
    returns = {'novice': 10, 'advanced': 30, 'expert': 60, 'master': 240}
    for identity, row in sorted(tables[b'REFR'].items()):
        base = row.get('base')
        produce = fish.get(base) or racks.get(base)
        if not produce or row.get('deleted') or context.off(identity):
            continue
        position = row.get('pos')
        if not position or len(position) != 3 or not all(P.math.isfinite(v) for v in position):
            raise ValueError('Invalid resource placement: ' + identity)
        hold, via = context.place(dict(row, pos=position[:2]), None)
        water = waters['where'].get(row.get('cell')) or waters['where'].get(row.get('world'))
        water_record = waters['waters'].get(water, {})
        item = dict(ref=identity, base=base, hold=context.hold_name(hold) if hold else 'no hold',
            holdFrom=via, location=context.cell_label(row), cell=row.get('cell'), world=row.get('world'),
            x=position[0], y=position[1], z=position[2], source=produce['from'],
            produce=produce['name'], item=produce['produce'], rank=produce['rank'],
            returnMinutes=returns[produce['rank']], sharedStock=1,
            water=water, waterType=water_record.get('e', ''), waterClass=water_record.get('c', ''),
            access='Fisher' if base in fish else 'Hunter')
        (catches if base in fish else hanging).append(item)
    animals = P.write_hunting_spots(population['npcs'])
    resource_columns = ['ref', 'base', 'hold', 'location', 'cell', 'world', 'x', 'y', 'z',
        'source', 'produce', 'item', 'rank', 'access', 'returnMinutes', 'sharedStock',
        'water', 'waterType', 'waterClass', 'holdFrom']
    write_csv('FISHING-SPOTS.csv', catches, resource_columns)
    write_csv('HANGING-GAME-SPOTS.csv', hanging, resource_columns)
    payload = {'version': 1, 'builtBy': 'scripts/dev/Build-ResourceLocations.py',
        'loadOrder': population['loadOrder'], 'fishing': catches, 'hangingGame': hanging}
    with (ROOT / 'game/data/resource-locations.json').open('w', encoding='utf-8', newline='\n') as output:
        json.dump(payload, output, ensure_ascii=False, separators=(',', ':'))
        output.write('\n')
    print(json.dumps({'fishingSpots': len(catches), 'hangingGameSpots': len(hanging),
        'animalPlacements': len(animals), 'dressablePlacements': sum(bool(row['products']) for row in animals),
        'fishingByRank': dict(collections.Counter(row['rank'] for row in catches))}))


if __name__ == '__main__':
    main()
