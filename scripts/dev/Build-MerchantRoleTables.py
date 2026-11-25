"""Derive inactive merchant permissions from public work and measured records.

This writes source data only. It never installs files, initializes an economy,
or changes the active merchant roster. --check needs no installed game.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'game/data/merchant-role-tables.json'
INPUTS = ('game/data/recipes.json', 'game/data/harvests.json', 'game/data/hunts.json',
          'game/data/items.json', 'game/data/cut-items.json')
ROLES = ('Smith', 'Woodworker', 'Tailor', 'Enchanter', 'Cook', 'Alchemist')
ITEM_TYPES = ('ALCH', 'AMMO', 'ARMO', 'BOOK', 'INGR', 'KEYM', 'MISC', 'SCRL', 'SLGM', 'WEAP')
SOUL_GEMS = {('SoulGem' + size + suffix).lower() for size in
             ('Petty', 'Lesser', 'Common', 'Greater', 'Grand', 'Black') for suffix in ('', 'Filled')}
STATIONS = ('saltPile', 'fireSalts', 'frostSalts', 'voidSalts', 'chickenEgg', 'honeycomb', 'milk', 'butter')


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def input_bundle():
    contents = {name: (ROOT / name).read_bytes() for name in INPUTS}
    return ([json.loads(contents[name].decode('utf-8')) for name in INPUTS],
            {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()})


def source_hashes_match(stored, current):
    # Older verified content builds record this input at its previous path.
    # The same exact bytes must be present at the new path.
    previous = 'docs/systems/cut-items.json'
    current_path = 'game/data/cut-items.json'
    if previous in stored and current_path not in stored:
        stored = {current_path if name == previous else name: digest
                  for name, digest in stored.items()}
    return stored == current


def public(row):
    return row.get('owner') in ROLES and row.get('fires') is True and row.get('book') != 'cut' and not row.get('roll')


def resources(harvests, hunts, items):
    for group in ('harvests', 'crops', 'fish', 'game'):
        for key, row in harvests.get(group, {}).items():
            if row.get('produce'):
                yield row['produce'], 'harvests:' + group + ':' + key
            for index, part in enumerate(row.get('gives', [])):
                yield part['item'], 'harvests:' + group + ':' + key + ':' + str(index)
    for key, row in hunts.get('hunts', {}).items():
        for index, part in enumerate(row.get('gives', [])):
            yield part['item'], 'hunts:' + key + ':' + str(index)
    for key in STATIONS:
        if key in items:
            yield items[key], 'station:' + key


def record_of(records, desc, expected=None):
    match = re.fullmatch(r'([0-9a-f]{1,6}):([^:/\\]+\.(?:esm|esp|esl))', desc, re.I) if isinstance(desc, str) else None
    if (not match or not int(match[1], 16) or match[1] != format(int(match[1], 16), 'x') or
            int(match[1], 16) == 15 and match[2].lower() == 'skyrim.esm'):
        raise ValueError('Invalid static item identity or currency: ' + str(desc))
    row = records.get(desc)
    if not isinstance(row, dict) or row.get('type') not in ITEM_TYPES:
        raise ValueError('Unresolved item record: ' + desc)
    flags = row.get('flags')
    if type(flags) is not int or flags < 0 or flags > 0xffffffff or flags & 0x20:
        raise ValueError('Invalid or deleted item record: ' + desc)
    if row['type'] in ('ARMO', 'WEAP') and flags & 4:
        raise ValueError('A nonplayable item cannot enter ordinary trade: ' + desc)
    if expected and row['type'] != expected:
        raise ValueError('Item type disagrees with its source: ' + desc)
    return row


def derive(recipes, harvests, hunts, items, cuts, records):
    owned = recipes['recipes']
    rows = {key: row for key, row in owned.items() if public(row)}
    cut_references = {row['id'] for row in cuts['items']}
    if set(rows) & cut_references:
        raise ValueError('A public recipe is explicitly excluded by source policy')
    public_outputs = {row['out'] for row in rows.values()}
    # The kept Dwarven scrap smelt is in the unowned map. A duplicate smelt
    # being refused does not remove the ingot. Tempering is not a producer.
    public_outputs.update(row['out'] for key, row in recipes.get('unowned', {}).items()
                          if key not in cut_references and row.get('benchName') in
                          ('CraftingSmelter', 'CraftingTanningRack') and
                          row.get('book') != 'cut' and not row.get('roll'))
    recipe_index = {**recipes.get('refused', {}), **recipes.get('unowned', {}), **owned}
    excluded = set()
    for cut in cuts['items']:
        reference = cut['id']
        producer = reference in recipe_index
        if producer:
            item = recipe_index[reference]['out']
        else:
            record_of(records, reference)
            item = reference
        if cut['disposition'] not in ('cut', 'embassy', 'thalmor'):
            raise ValueError('Unknown excluded item disposition: ' + reference)
        if producer and item in public_outputs:
            if cut['disposition'] != 'cut':
                raise ValueError('Conflicting public and faction item policy: ' + item)
        else:
            excluded.add(item)
    tables = {role: {direction: set() for direction in ('buy', 'sell', 'supply')} for role in ROLES}
    evidence = {}

    def add(role, item, source, supply=False, expected=None):
        record_of(records, item, expected)
        if item in excluded:
            raise ValueError('An excluded item enters a public source: ' + item)
        tables[role]['buy'].add(item)
        tables[role]['sell'].add(item)
        if supply:
            tables[role]['supply'].add(item)
        evidence.setdefault(item, set()).add(role + ':' + source)

    wearables = set()
    for key, row in rows.items():
        if row.get('race') == 'riekling' and row['name'] not in cuts['rieklingKept']:
            raise ValueError('Unapproved Riekling company item: ' + row['name'])
        add(row['owner'], row['out'], 'recipe:' + key + ':out', expected=row['type'])
        if row['type'] == 'ARMO':
            wearables.add(row['out'])
        for index, ingredient in enumerate(row['inputItems']):
            if ingredient['item'].lower() == 'f:skyrim.esm':
                continue  # A crafting fee is not a good the trader buys or supplies.
            add(row['owner'], ingredient['item'], 'recipe:' + key + ':input:' + str(index),
                supply=True, expected=ingredient.get('type'))
    for item, source in resources(harvests, hunts, items):
        row = record_of(records, item)
        if row['type'] == 'INGR':
            add('Alchemist', item, source, supply=True)
        elif row['type'] == 'ALCH' and row.get('food') is True:
            add('Cook', item, source, supply=True)
    for item in sorted(wearables):
        add('Enchanter', item, 'wardweaver:public-wearable', expected='ARMO')
    for item, row in records.items():
        if item.lower().endswith(':skyrim.esm') and row.get('type') == 'SLGM' and row.get('edid', '').lower() in SOUL_GEMS:
            add('Enchanter', item, 'soul-gem:' + row['edid'], supply=True, expected='SLGM')
    for role, table in tables.items():
        if not table['buy'] or not table['supply']:
            raise ValueError('Empty role table: ' + role)
    return ({role: {direction: sorted(values) for direction, values in table.items()}
             for role, table in tables.items()},
            {item: sorted(sources) for item, sources in sorted(evidence.items())})


def reader():
    path = ROOT / 'scripts/mods/Build-LastPlugin.py'
    spec = importlib.util.spec_from_file_location('role_plugin_reader', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_envelopes(data):
    if len(data) < 24 or data[:4] != b'TES4':
        raise ValueError('Invalid native plugin header')
    at = 24 + struct.unpack_from('<I', data, 4)[0]
    if at > len(data):
        raise ValueError('Truncated native plugin header')
    ends = [len(data)]
    tags = set()
    while at < len(data):
        while len(ends) > 1 and at == ends[-1]:
            ends.pop()
        if at + 24 > ends[-1]:
            raise ValueError('Truncated native record header')
        size = struct.unpack_from('<I', data, at + 4)[0]
        group = data[at:at + 4] == b'GRUP'
        end = at + size if group else at + 24 + size
        if group and size < 24 or end > ends[-1]:
            raise ValueError('Truncated native record or group envelope')
        if group:
            ends.append(end)
            at += 24
        else:
            tags.add(data[at:at + 4])
            at = end
    return tags


def plugin_records(module, path, name, index, order, expected_sha=None):
    plugin = module.Plugin(str(path), name, index)
    actual_sha = hashlib.sha256(plugin.buf).hexdigest()
    if expected_sha is not None and actual_sha != expected_sha:
        raise ValueError('Plugin source pin changed: ' + name)
    tags = validate_envelopes(plugin.buf)
    canonical = {row['name'].lower(): row['name'] for row in order}
    positions = {row['name'].lower(): i for i, row in enumerate(order)}
    for master in plugin.masters:
        if master.lower() not in positions or positions[master.lower()] >= index:
            raise ValueError('Missing or late plugin master: ' + master)
    plugin.masters = [canonical[master.lower()] for master in plugin.masters]
    result = {}
    for entry in plugin.walk(tags):
        item_type = entry.tag.decode('ascii')
        if entry.fid >> 24 > len(plugin.masters):
            if item_type in ITEM_TYPES:
                raise ValueError('Runtime or invalid source form in ' + name)
            continue  # Non-item engine sentinels cannot override a static good.
        owner, local = plugin.gid(entry.fid)
        if not local:
            continue
        if item_type not in ITEM_TYPES and entry.fid >> 24 == len(plugin.masters):
            continue
        desc = '%x:%s' % (local, canonical[owner])
        row = {'type': entry.tag.decode('ascii'), 'flags': entry.flags, 'edid': '', 'winner': name}
        if row['type'] == 'ALCH':
            row['food'] = False
        if item_type in ITEM_TYPES and not entry.flags & 0x20:
            for tag, body in module.subrecords(plugin.data(entry)):
                if tag == b'EDID':
                    row['edid'] = body.rstrip(b'\0').decode('ascii')
                elif tag == b'ENIT' and row['type'] == 'ALCH':
                    if len(body) < 8:
                        raise ValueError('Truncated food flags: ' + desc)
                    row['food'] = bool(struct.unpack_from('<I', body, 4)[0] & 2)
        result[desc] = row
    return result, actual_sha


def source_order():
    order = load(ROOT / 'game/data/npc-population.json')['loadOrder']
    names = [row['name'].lower() for row in order]
    if len(names) != len(set(names)):
        raise ValueError('Duplicate source plugins')
    return order


def generate(inputs, data, input_hashes):
    module, order, records, proof = reader(), source_order(), {}, []
    for index, source in enumerate(order):
        name = source['name']
        own = ROOT / 'game/content' / name
        path = own if own.is_file() else data / name
        parsed, actual = plugin_records(module, path, name, index, order,
                                        None if own.is_file() else source['sha256'])
        proof.append({'name': name, 'sha256': actual, 'repository': own.is_file()})
        records.update(parsed)
    recipes, harvests, hunts, items, cuts = inputs
    needed = {item for item, _ in resources(harvests, hunts, items)}
    recipe_index = {**recipes.get('refused', {}), **recipes.get('unowned', {}), **recipes['recipes']}
    needed.update(row['id'] for row in cuts['items'] if row['id'] not in recipe_index)
    for row in recipes['recipes'].values():
        if public(row):
            needed.add(row['out'])
            needed.update(part['item'] for part in row['inputItems'])
    needed.update(item for item, row in records.items() if item.lower().endswith(':skyrim.esm') and
                  row['type'] == 'SLGM' and row['edid'].lower() in SOUL_GEMS)
    selected = {item: records[item] for item in sorted(needed) if item in records}
    tables, evidence = derive(*inputs, selected)
    return {'version': 1, 'active': False, 'builtBy': 'scripts/dev/Build-MerchantRoleTables.py',
            'sources': input_hashes, 'loadOrder': proof,
            'records': selected, 'tables': tables, 'evidence': evidence,
            'counts': {role: {direction: len(ids) for direction, ids in table.items()}
                       for role, table in tables.items()}}


def validate_provenance(payload):
    order = source_order()
    if len(order) != len(payload['loadOrder']):
        raise ValueError('Role-table load order is stale')
    positions = {row['name']: i for i, row in enumerate(order)}
    module = reader()
    own_records = {}
    own_names = set()
    for index, (expected, proof) in enumerate(zip(order, payload['loadOrder'])):
        name = expected['name']
        own = ROOT / 'game/content' / name
        if proof['name'] != name or proof['repository'] != own.is_file():
            raise ValueError('Role-table source ownership changed: ' + name)
        if own.is_file():
            own_names.add(name)
            own_records.update(plugin_records(module, own, name, index, order)[0])
        elif expected['sha256'] != proof['sha256']:
            raise ValueError('Role-table source pin changed: ' + name)
    # Unrelated own-plugin art/quest changes need no installed game to check.
    # Recheck every contributing record's type, flags, identity and food bit.
    for item, row in payload['records'].items():
        if item.split(':', 1)[1] not in positions or row['winner'] not in positions:
            raise ValueError('Unknown winning source: ' + item)
        actual = own_records.get(item)
        if row['winner'] in own_names and actual != row:
            raise ValueError('Repository-owned item evidence changed or disappeared: ' + item)
        if actual and positions[actual['winner']] >= positions[row['winner']] and actual != row:
            raise ValueError('Repository-owned item evidence changed: ' + item)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate committed data without reading installed files')
    parser.add_argument('--data', type=Path, default=Path('C:/Thornswood/Game/Data'))
    args = parser.parse_args()
    inputs, input_hashes = input_bundle()
    if args.check:
        payload = load(OUT)
        if payload['version'] != 1 or payload['active'] is not False or not source_hashes_match(payload['sources'], input_hashes):
            raise ValueError('Role-table source evidence is stale')
        validate_provenance(payload)
        tables, evidence = derive(*inputs, payload['records'])
        if tables != payload['tables'] or evidence != payload['evidence']:
            raise ValueError('Role tables differ from their measured sources')
        if payload['counts'] != {role: {direction: len(ids) for direction, ids in table.items()} for role, table in tables.items()}:
            raise ValueError('Role-table counts differ from their actual lists')
    else:
        payload = generate(inputs, args.data, input_hashes)
        validate_provenance(payload)
        if input_hashes != {name: digest(ROOT / name) for name in INPUTS}:
            raise ValueError('Role-table input sources changed during generation')
        with OUT.open('w', encoding='utf-8', newline='\n') as output:
            output.write(json.dumps(payload, ensure_ascii=True, indent=2) + '\n')
        print(json.dumps(payload['counts'], sort_keys=True))
    print('PASS inactive six-role item data follows its public sources')


if __name__ == '__main__':
    main()
