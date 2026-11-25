"""Measure the seven retrieval placements, and the scarce geode and harvest
sources, in the complete, pinned load order.

Reads the game's plugins (on One, or a box run's data folder); writes only source evidence in this checkout. No
server operation or generated placement is performed here.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import struct
import sys
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
import own_plugins
spec = importlib.util.spec_from_file_location('retrieval_population', ROOT / 'scripts/dev/Build-NpcPopulation.py')
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)
C = P.C
C.WANTED = tuple(dict.fromkeys(C.WANTED + (b'ACTI', b'CONT', b'MISC')))

TERMS = [
    ('satchel', "17dfdc:JK's Whiterun's Outskirts.esp", 'Whiterun', 'Woodworker', 20, 3),
    ('ledger', '17208:Thornswood-Content.esp', 'Whiterun', 'Enchanter', 30, 6),
    ('signet', 'c2a35:Skyrim.esm', 'Whiterun', 'Smith', 40, 8),
    ('locket', '3906d:Skyrim.esm', 'Falkreath', 'Tailor', 45, 10),
    ('case', 'ea73b:Skyrim.esm', 'Whiterun', 'Tailor', 50, 8),
    ('dispatch', '547e8:Skyrim.esm', 'Whiterun', 'Cook', 60, 12),
    ('seal', '53ff6:Skyrim.esm', 'Whiterun', 'Alchemist', 70, 14),
]

# The scarce sources the merchant quests send people to (#5191): the Blackreach
# geodes and crimson nirnroot. What each quest asks for is written here; where
# each source stands (its base, its world and its position) is measured in the
# same load order as the retrievals, so a move of the order measures them again
# and their documents name the order they were measured in. Until 13 Nov 2026
# they were measured once by hand and pinned to that order, so the box's first
# build of collection revision 8, which only added a plugin of eyes, stopped
# here: nothing could measure them again.
SCARCE = [
    ('game/data/merchant-scarce-geodes.json', 'geode', 'Blackreach geodes', '2e4e2:Skyrim.esm', 'SLGM', 'novice', 30, [
      '10fc57:Skyrim.esm',
      '10eb24:Skyrim.esm',
      '10e994:Skyrim.esm',
      '10e955:Skyrim.esm',
      '10e8bb:Skyrim.esm',
      '10fc4c:Skyrim.esm']),
    ('game/data/merchant-scarce-harvest.json', 'crimson', 'Blackreach', 'b701a:Skyrim.esm', 'INGR', 'novice', 10, [
      'f3b51:Skyrim.esm',
      'f3b54:Skyrim.esm',
      'f3b5d:Skyrim.esm',
      '10ffac:Skyrim.esm',
      '10ffaf:Skyrim.esm',
      '10ffb0:Skyrim.esm',
      'f3b56:Skyrim.esm',
      '10ffa9:Skyrim.esm']),
]

def digest(value):
    return hashlib.sha256(json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()

def pinned_order(order):
    # Own plugins by name only, the same digest as MerchantLoadOrderPin.js (#613).
    return [{'name': row['name'], 'sha256': '' if own_plugins.is_own(row['name']) else row['sha256']} for row in order]

def verify_plugin_sha(name, actual, pinned):
    # Only the authored Content prerequisite has intentionally newer bytes.
    # A repository copy of any other plugin still owes the public file proof.
    if name != 'Thornswood-Content.esp' and actual != pinned:
        raise ValueError('Source plugin differs from pinned load order: ' + name)

def fields(raw):
    """Strict native-style ordered subrecords; selected references use no XXXX."""
    at, out = 0, []
    while at < len(raw):
        if at + 6 > len(raw):
            raise ValueError('Truncated retrieval field header')
        tag, size = raw[at:at + 4], struct.unpack_from('<H', raw, at + 4)[0]
        end = at + 6 + size
        if tag == b'XXXX' or end > len(raw):
            raise ValueError('Unsupported or truncated retrieval field')
        out.append([tag.decode('ascii'), raw[at + 6:end].hex()])
        at = end
    return out

def winning_refs(plugin, index, sha, wanted, winners):
    buf = plugin.buf
    def walk(start, end):
        at = start
        while at < end:
            if at + 24 > end:
                raise ValueError('Truncated plugin record envelope: ' + plugin.name)
            tag, size = buf[at:at + 4], struct.unpack_from('<I', buf, at + 4)[0]
            limit = at + (size if tag == b'GRUP' else size + 24)
            if limit > end or limit < at + 24:
                raise ValueError('Invalid plugin record size: ' + plugin.name)
            if tag == b'GRUP':
                walk(at + 24, limit)
            else:
                flags, fid = struct.unpack_from('<II', buf, at + 8)
                identity = plugin.desc(fid)
                if tag == b'REFR' and identity in wanted:
                    raw = buf[at + 24:limit]
                    if flags & 0x40000:
                        if len(raw) < 4:
                            raise ValueError('Truncated compressed retrieval record')
                        expected = struct.unpack_from('<I', raw)[0]
                        inflater = zlib.decompressobj()
                        raw = inflater.decompress(raw[4:]) + inflater.flush()
                        if not inflater.eof or inflater.unused_data or len(raw) != expected:
                            raise ValueError('Invalid compressed retrieval record')
                    record = ['REFR', fid, flags, fields(raw)]
                    winners[identity] = {'fileIndex': index, 'plugin': plugin.name,
                        'pluginSha256': sha, 'recordSha256': digest(record),
                        'rawId': fid, 'record': record, 'masters': plugin.masters}
            at = limit
    walk(24 + plugin.header, len(buf))

def measure_scarce(refs, off, order):
    """Each SCARCE document, measured from the winning REFR rows (refs) in the
    load order whose pinned digest is order; off says whether a reference is
    switched off at the start. Stops on a source that is gone or off."""
    out = []
    for target, quest, label, item, item_type, rank, minutes, wanted in SCARCE:
        found = []
        for ref in wanted:
            row = refs.get(ref)
            if not row or row.get('deleted') or off(ref) or not row.get('pos') or not row.get('base'):
                raise ValueError('Scarce source absent or disabled: ' + ref)
            found.append({'reference': ref, 'base': row['base'], 'world': row.get('world') or row['cell'],
                'position': list(row['pos']), 'item': item, 'itemType': item_type, 'rank': rank, 'returnMinutes': minutes})
        out.append((target, {'version': 1, 'quest': quest, 'label': label, 'loadOrderSha256': order, 'sources': found}))
    return out

def build(data):
    population = json.loads((ROOT / 'game/data/npc-population.json').read_text(encoding='utf-8'))
    roster = json.loads((ROOT / 'game/data/merchant-roster.json').read_text(encoding='utf-8'))['merchants']
    tables = {tag: {} for tag in C.WANTED}
    tables.update({b'ACHR': {}, b'REFR': {}, b'ECZN': {}})
    winners = {}
    wanted = {r[1] for r in TERMS}
    for index, entry in enumerate(population['loadOrder']):
        name = entry['name']
        owned = ROOT / 'game/content' / name
        path = owned if owned.is_file() else data / name
        plugin = C.Plugin(str(path), name)
        sha = hashlib.sha256(plugin.buf).hexdigest()
        verify_plugin_sha(name, sha, entry['sha256'])
        winning_refs(plugin, index, sha, wanted, winners)
        C.read(plugin, tables)
        P.read_details(plugin, tables)
    cast = C.Cast(tables)
    rows, fixtures = [], []
    for i, (quest, ref, hold, role, gold, hours) in enumerate(TERMS):
        row = tables[b'REFR'].get(ref)
        if not row or row.get('deleted') or cast.off(ref) or not row.get('pos'):
            raise ValueError('Retrieval source absent or disabled: ' + ref)
        base_type = 'ACTI' if quest == 'ledger' else 'CONT'
        if row['base'] not in tables[base_type.encode()]:
            raise ValueError('Retrieval source base type differs: ' + ref)
        merchant = next(r for r in roster if r['hold'] == hold and r['role'] == role)
        destination = next(r for r in roster if r['hold'] == 'Eastmarch' and r['role'] == 'Cook') if quest == 'dispatch' else merchant
        proof = dict(winners[ref])
        fixtures.append({'reference': ref, 'record': proof.pop('record'), 'masters': proof.pop('masters')})
        rows.append({'quest': quest, 'reference': ref, 'base': row['base'], 'baseType': base_type,
            'cell': row['cell'], 'world': row.get('world') or row['cell'],
            'spaceType': 'WRLD' if row.get('world') else 'CELL', 'position': row['pos'],
            'item': '%x:Thornswood-Content.esp' % (0x17000 + i), 'itemType': 'MISC',
            'merchant': merchant['reference'], 'destination': destination['reference'],
            'role': role, 'hold': hold, 'destinationHold': destination['bookHold'],
            'gold': gold, 'hours': hours, 'provenance': proof})
    content = (ROOT / 'game/content/Thornswood-Content.esp').read_bytes()
    order = digest(pinned_order(population['loadOrder']))
    return {'version': 1, 'loadOrderSha256': order,
        'contentSha256': hashlib.sha256(content).hexdigest(), 'sources': rows}, fixtures, measure_scarce(tables[b'REFR'], cast.off, order)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', type=Path, default=Path('C:/Thornswood/Game/Data'))
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    doc, fixtures, scarce = build(args.data)
    for target, value in [('game/data/merchant-retrievals.json', doc),
                          ('tests/fixtures/merchant-retrieval-records.json', fixtures)] + scarce:
        text = json.dumps(value, indent=2, ensure_ascii=False) + '\n'
        path = ROOT / target
        if args.check:
            if not path.is_file() or path.read_text(encoding='utf-8') != text:
                raise ValueError('Retrieval source evidence is stale: ' + target)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            # LF on every machine, as .gitattributes stores it (#3029).
            with path.open('w', encoding='utf-8', newline='\n') as output:
                output.write(text)
    print('PASS seven retrieval sources and ' + str(sum(len(d['sources']) for _, d in scarce)) +
          ' scarce sources measured in the complete pinned load order; manifest sha256=' + digest(doc))

if __name__ == '__main__':
    main()
