"""Run the actual admin-name builder over native-format plugin records.

Canonical recipe names disambiguate same-plugin homonyms. No installed game
or live server is changed; all generated tables stay in this owned fixture.
"""
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']


def sub(tag, data):
    return tag + struct.pack('<H', len(data)) + data


def rec(tag, fid, body=b'', flags=0):
    return tag + struct.pack('<IIIII', len(body), flags, fid, 0, 0) + body


def group(tag, records):
    body = b''.join(records)
    return b'GRUP' + struct.pack('<I', 24+len(body)) + tag + bytes(12) + body


def plugin(groups=(), master=None):
    header = sub(b'HEDR', struct.pack('<fiI', 1.7, 0, 0x800))
    if master:
        header += sub(b'MAST', master.encode()+b'\0') + sub(b'DATA', bytes(8))
    return rec(b'TES4', 0, header) + b''.join(groups)


def named(tag, fid, name, edid, value=0, weight=0, flags=0, extra=b''):
    return rec(tag, fid, sub(b'EDID', edid.encode()+b'\0') + sub(b'FULL', name.encode()+b'\0')
        + sub(b'DATA', struct.pack('<If', value, weight)) + extra, flags)


class Builder(unittest.TestCase):
    def setUp(self):
        (ROOT/'temp').mkdir(exist_ok=True)
        self.work = tempfile.TemporaryDirectory(prefix='4819-', dir=ROOT/'temp')
        self.addCleanup(self.work.cleanup)
        self.folder = Path(self.work.name)
        self.data, self.tables = self.folder/'Data', self.folder/'tables'
        self.data.mkdir(); self.tables.mkdir()
        for name in MASTERS:
            (self.data/name).write_bytes(plugin())
        self.list = self.folder/'plugins.txt'
        self.list.write_text('*Later.esp\n', encoding='utf-8')
        self.canonical = {
            'petty soul gem': ['Petty Soul Gem', '2e4e2:Skyrim.esm'],
            'orichalcum ingot': ['Orichalcum Ingot', '5ad99:Skyrim.esm'],
            'shared item': ['Shared Item', '801:Later.esp'],
            'hidden piece': ['Hidden Piece', 'a00:Skyrim.esm'],
        }
        self.write_canonical()
        self.build_plugins()

    def write_canonical(self, value=...):
        (self.tables/'ITEM_NAMES.json').write_text(json.dumps(self.canonical if value is ... else value), encoding='utf-8')

    def build_plugins(self, reverse=False):
        misc = [
            named(b'MISC', 0x1fe9b, 'Petty Soul Gem', 'MGR11GrandSoulGem', weight=.5),
            named(b'MISC', 0x43e27, 'Orichalcum Ingot', 'FFRiften14Ingot'),
            named(b'MISC', 0x5ad99, 'Orichalcum Ingot', 'IngotOrichalcum', 45, 1),
            named(b'MISC', 0x900, 'Shared Item', 'VanillaSharedItem', 1, 1),
            named(b'MISC', 0x901, 'Fallback Name', 'LowerFallback', 1, 1),
            named(b'MISC', 0x902, 'Fallback Name', 'HigherFallback', 1, 1),
            named(b'MISC', 0xa02, 'Deleted Piece', 'DeletedPiece', 1, 1),
            named(b'MISC', 0xa03, '__proto__', 'PrototypeName', 1, 1),
        ]
        armour = [named(b'ARMO', 0xa00, 'Hidden Piece', 'NonPlayablePiece', flags=4),
                  named(b'ARMO', 0xa01, 'Hidden Piece', 'PlayablePiece', 1, 1)]
        actor = lambda fid, flags: rec(b'NPC_', fid, sub(b'FULL', b'Fixture Actor\0')
            + sub(b'ACBS', bytes(18)+struct.pack('<H', flags)+bytes(4))
            + (sub(b'TPLT', struct.pack('<I', 0xb00)) if flags else b''))
        actors = [actor(0xb00, 0), actor(0xb01, 1), actor(0xb02, 0)]
        # The templated candidate is lower-numbered than the own-traits candidate.
        actors = [actors[1], actors[2]]
        if reverse:
            misc.reverse(); armour.reverse(); actors.reverse()
        (self.data/'Skyrim.esm').write_bytes(plugin([
            group(b'MISC', misc), group(b'ARMO', armour), group(b'NPC_', actors),
            group(b'SLGM', [named(b'SLGM', 0x2e4e2, 'Petty Soul Gem', 'SoulGemPetty', 10, .1,
                extra=sub(b'SOUL', bytes([0]))+sub(b'SLCP', bytes([1])))])]))
        (self.data/'Later.esp').write_bytes(plugin([
            group(b'MISC', [named(b'MISC', 0x1000801, 'Shared Item', 'LaterSharedItem', 2, 1),
                rec(b'MISC', 0xa02, flags=0x20)])], master='Skyrim.esm'))

    def run_builder(self):
        return subprocess.run([sys.executable, str(ROOT/'scripts/dev/Build-AdminNameTables.py'),
            '--data', str(self.data), '--plugins', str(self.list), '--tables', str(self.tables)],
            capture_output=True, text=True, timeout=30)

    def built(self):
        result = self.run_builder()
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        return json.loads((self.tables/'ADMIN_ITEMS.json').read_text()), json.loads((self.tables/'ADMIN_ACTORS.json').read_text())

    def test_native_soul_gem_and_ingot_homonyms_choose_recipe_records(self):
        items, actors = self.built()
        self.assertEqual(items['petty soul gem'][1], '2e4e2:Skyrim.esm')
        self.assertEqual(items['orichalcum ingot'][1], '5ad99:Skyrim.esm')
        self.assertGreater(len(items), 4)
        self.assertGreater(len(actors), 0)

    def test_record_order_does_not_change_either_complete_output(self):
        first = self.built()
        self.build_plugins(reverse=True)
        second = self.built()
        self.assertEqual(second, first)
        self.assertEqual(second[0]['orichalcum ingot'][1], '5ad99:Skyrim.esm')

    def test_earliest_plugin_and_noncanonical_fallback_and_actor_traits_stay(self):
        items, actors = self.built()
        self.assertEqual(items['shared item'][1], '900:Skyrim.esm')
        self.assertEqual(items['fallback name'][1], '901:Skyrim.esm')
        self.assertEqual(actors['fixture actor'][1], 'b02:Skyrim.esm')

    def test_preferences_never_resurrect_excluded_records(self):
        items, _ = self.built()
        self.assertEqual(items['hidden piece'][1], 'a01:Skyrim.esm')
        self.assertNotIn('deleted piece', items)
        self.assertNotIn('__proto__', items)

    def test_malformed_preferences_fail_before_either_output_is_written(self):
        for bad in [None, {}, [], 3, {'wrong':['Wrong']}, {'wrong':['Wrong', 5]},
                    {'Wrong':['Wrong','a:Skyrim.esm']}, {'wrong':['Wrong','not a descriptor']}]:
            with self.subTest(bad=bad):
                self.write_canonical(bad)
                for name in ['ADMIN_ITEMS', 'ADMIN_ACTORS']:
                    (self.tables/(name+'.json')).write_text('untouched '+name)
                result = self.run_builder()
                self.assertNotEqual(result.returncode, 0)
                for name in ['ADMIN_ITEMS', 'ADMIN_ACTORS']:
                    self.assertEqual((self.tables/(name+'.json')).read_text(), 'untouched '+name)

    def test_missing_preferences_fail_before_writing(self):
        (self.tables/'ITEM_NAMES.json').unlink()
        result = self.run_builder()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.tables/'ADMIN_ITEMS.json').exists())
        self.assertFalse((self.tables/'ADMIN_ACTORS.json').exists())

    def test_broken_json_preserves_both_existing_outputs(self):
        (self.tables/'ITEM_NAMES.json').write_text('{', encoding='utf-8')
        for name in ['ADMIN_ITEMS', 'ADMIN_ACTORS']:
            (self.tables/(name+'.json')).write_text('untouched '+name)
        result = self.run_builder()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('STOP.', result.stdout)
        for name in ['ADMIN_ITEMS', 'ADMIN_ACTORS']:
            self.assertEqual((self.tables/(name+'.json')).read_text(), 'untouched '+name)

    def test_chain_builds_preferences_before_admin_names(self):
        steps = json.loads((ROOT/'scripts/mods/content-tables.json').read_text())['steps']
        item = next(i for i,row in enumerate(steps) if row['tool'].endswith('Build-ItemNameTable.js'))
        admin = next(i for i,row in enumerate(steps) if row['tool'].endswith('Build-AdminNameTables.py'))
        self.assertLess(item, admin)
        self.assertIn('game/gamemode-tables/ITEM_NAMES.json', steps[admin]['reads'])


if __name__ == '__main__':
    unittest.main()
