"""Exercise the actual strict reader, and the scarce sources' measurement,
without game files or third-party packages."""
from pathlib import Path
import ast
import hashlib
import json
import struct
import unittest
import zlib

source = Path(__file__).resolve().parents[1] / 'scripts/dev/Build-MerchantRetrievalSources.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
scope = dict(hashlib=hashlib, json=json, struct=struct, zlib=zlib)
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in
    {'digest', 'fields', 'winning_refs', 'verify_plugin_sha', 'measure_scarce'} or
    isinstance(n, ast.Assign) and [t.id for t in n.targets if isinstance(t, ast.Name)] == ['SCARCE']], type_ignores=[]), str(source), 'exec'), scope)

def record(body=b'', flags=0, fid=1):
    return struct.pack('<4sIIIII', b'REFR', len(body), flags, fid, 0, 0) + body

def group(body, size=None):
    return struct.pack('<4sIIIII', b'GRUP', len(body) + 24 if size is None else size, 0, 0, 0, 0) + body

class Plugin:
    name, header, masters = 'source.esp', 0, []
    def __init__(self, raw):
        self.buf = bytes(24) + raw
    def desc(self, fid):
        return '%x:source.esp' % fid

class Reader(unittest.TestCase):
    def test_repository_copies_owe_the_same_external_hash(self):
        for name in ['Skyrim.esm', 'Thornswood-Last.esp', 'shadow.esp']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                scope['verify_plugin_sha'](name, 'changed', 'pinned')
            scope['verify_plugin_sha'](name, 'pinned', 'pinned')
        scope['verify_plugin_sha']('Thornswood-Content.esp', 'authored', 'older')

    def scan(self, raw, winners=None, index=0):
        out = {} if winners is None else winners
        scope['winning_refs'](Plugin(raw), index, 'a' * 64, {'1:source.esp'}, out)
        return out

    def test_full_order_last_winner_and_ordered_fields(self):
        body = b'NAME\x04\x00' + struct.pack('<I', 7) + b'EDID\x02\x00x\0'
        out = self.scan(group(record(body)))
        self.assertEqual(out['1:source.esp']['record'][3], [['NAME', '07000000'], ['EDID', '7800']])
        self.scan(record(body, flags=0x800), out, index=2)
        self.assertEqual(out['1:source.esp']['fileIndex'], 2)
        self.assertEqual(out['1:source.esp']['record'][2], 0x800)

    def test_truncated_and_invalid_envelopes(self):
        for raw in [b'REFR', record() + b'x', group(b'', 0), group(b'', 23), group(b'', 25),
                    group(record()[:-1]), record(b'DATA\x18\x00' + bytes(23))]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                self.scan(raw)

    def test_compression_length_trailing_data_and_incomplete_stream(self):
        payload = b'NAME\x04\x00' + struct.pack('<I', 7)
        compressed = zlib.compress(payload)
        good = struct.pack('<I', len(payload)) + compressed
        self.assertEqual(self.scan(record(good, 0x40000))['1:source.esp']['record'][3], [['NAME', '07000000']])
        for raw in [b'123', good[:-1], good + b'x', struct.pack('<I', len(payload) + 1) + compressed]:
            with self.subTest(raw=raw), self.assertRaises((ValueError, zlib.error)):
                self.scan(record(raw, 0x40000))

class Scarce(unittest.TestCase):
    # The scarce geode and harvest sources are measured in the load order
    # (#5191): each document is written from the winning REFR rows, in the
    # shape and order of keys the committed documents and their pins have.
    root = Path(__file__).resolve().parents[1]

    def rows(self):
        refs = {}
        for target, *_ in scope['SCARCE']:
            for s in json.loads((self.root / target).read_text(encoding='utf-8'))['sources']:
                refs[s['reference']] = {'base': s['base'], 'world': s['world'], 'cell': 'c', 'pos': tuple(s['position'])}
        return refs

    def test_measured_documents_are_the_committed_ones_but_for_the_order(self):
        out = scope['measure_scarce'](self.rows(), lambda ref: False, 'f' * 64)
        self.assertEqual([t for t, _ in out], ['game/data/merchant-scarce-geodes.json', 'game/data/merchant-scarce-harvest.json'])
        for target, doc in out:
            committed = json.loads((self.root / target).read_text(encoding='utf-8'))
            self.assertEqual(doc['loadOrderSha256'], 'f' * 64)
            committed['loadOrderSha256'] = doc['loadOrderSha256']
            self.assertEqual(json.dumps(doc), json.dumps(committed), target)

    def test_a_source_gone_or_off_stops_it(self):
        ref = scope['SCARCE'][0][7][0]
        for change in ['gone', 'deleted', 'off', 'unplaced']:
            rows = self.rows()
            if change == 'gone':
                del rows[ref]
            elif change == 'deleted':
                rows[ref]['deleted'] = True
            elif change == 'unplaced':
                del rows[ref]['pos']
            off = (lambda r: r == ref) if change == 'off' else (lambda r: False)
            with self.subTest(change=change), self.assertRaises(ValueError):
                scope['measure_scarce'](rows, off, 'f' * 64)

if __name__ == '__main__':
    unittest.main()
