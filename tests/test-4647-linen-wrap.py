"""Exercise the content writer's native COBJ and its canonical ownership data."""
import importlib.util
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('content', ROOT/'scripts/mods/Add-ContentRecords.py')
CONTENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTENT)
NAME = 'ThornswoodRecipeLinenWrap'


class LinenWrap(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = CONTENT.thornswood_records(CONTENT.clam01(), []) + CONTENT.seasonal_records()

    def test_native_recipe_makes_ordinary_linen_at_the_loom_from_one_cotton(self):
        matches = [r for r in self.records if r.editor_id() == NAME]
        self.assertEqual(len(matches), 1, 'the actual content writer must emit one linen recipe')
        raw = matches[0].bytes()
        self.assertEqual(raw[:4], b'COBJ')
        self.assertEqual(struct.unpack_from('<I', raw, 4)[0], len(raw)-24)
        fields = list(CONTENT.subrecords(raw[24:]))
        self.assertEqual([b for t,b in fields if t == b'CNAM'], [struct.pack('<I', 0x34cd6)])
        self.assertEqual([b for t,b in fields if t == b'BNAM'], [struct.pack('<I', 0x016ce000)])
        self.assertEqual([b for t,b in fields if t == b'NAM1'], [struct.pack('<H', 1)])
        self.assertEqual([b for t,b in fields if t == b'COCT'], [struct.pack('<I', 1)])
        self.assertEqual([b for t,b in fields if t == b'CNTO'], [struct.pack('<II', 0x3f7f8, 1)])
        self.assertFalse([b for t,b in fields if t == b'CTDA'], 'no extra perk or hidden gate')

    def test_recipe_is_canonical_haberdasher_work_like_the_existing_cotton_bandage(self):
        owners = json.loads((ROOT/'records/recipe-owners.json').read_text())['owner']
        self.assertTrue(NAME in owners, 'the linen recipe needs canonical profession ownership')
        for recipe in [NAME, 'ThornswoodRecipeBandage']:
            self.assertEqual((owners[recipe]['Owner'], owners[recipe]['Half']), ('Tailor', 'Haberdasher'))
            self.assertTrue(owners[recipe]['Why'])

    def test_authored_records_keep_unique_ids_and_editor_ids(self):
        self.assertGreater(len(self.records), 100)
        self.assertEqual(len({r.fid for r in self.records}), len(self.records))
        names = [r.editor_id() for r in self.records if r.editor_id()]
        self.assertEqual(len(names), len(set(names)))

    def test_plugin_description_accounts_for_the_new_native_record(self):
        description, unnamed = CONTENT.description_of([r.tag.decode() + ' ' + r.editor_id() for r in self.records])
        self.assertEqual(unnamed, [])
        self.assertIn(b'linen', description.lower())

    def test_proven_maker_removes_only_its_waiting_exception(self):
        waiting = json.loads((ROOT/'scripts/dev/Check-Makers.waiting.json').read_text())['items']
        self.assertFalse([r for r in waiting if r['desc'] == '34cd6:Skyrim.esm'])
        self.assertTrue([r for r in waiting if r['desc'] == 'f2012:Skyrim.esm'])


if __name__ == '__main__':
    unittest.main()
