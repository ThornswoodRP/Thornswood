"""The native content writer must spend one real milk item for one empty bottle."""
import importlib.util
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('content', ROOT/'scripts/mods/Add-ContentRecords.py')
CONTENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTENT)
NAME = 'ThornswoodRecipeEmptyBottleFromMilk'


class EmptyBottle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = CONTENT.thornswood_records(CONTENT.clam01(), []) + CONTENT.seasonal_records()

    def test_native_recipe_spends_one_milk_at_a_cookpot_for_one_ordinary_empty(self):
        matches = [r for r in self.records if r.editor_id() == NAME]
        self.assertEqual(len(matches), 1, 'the actual writer must emit one bottle recipe')
        raw = matches[0].bytes()
        self.assertEqual(raw[:4], b'COBJ')
        self.assertEqual(struct.unpack_from('<I', raw, 4)[0], len(raw)-24)
        self.assertEqual(CONTENT.PLUGIN_MASTERS[3], 'HearthFires.esm')
        fields = list(CONTENT.subrecords(raw[24:]))
        self.assertEqual([b for t,b in fields if t == b'CNAM'], [struct.pack('<I', 0xf2012)])
        self.assertEqual([b for t,b in fields if t == b'BNAM'], [struct.pack('<I', 0xa5cb3)])
        self.assertEqual([b for t,b in fields if t == b'NAM1'], [struct.pack('<H', 1)])
        self.assertEqual([b for t,b in fields if t == b'COCT'], [struct.pack('<I', 1)])
        self.assertEqual([b for t,b in fields if t == b'CNTO'], [struct.pack('<II', 0x03003534, 1)])
        self.assertFalse([b for t,b in fields if t == b'CTDA'], 'no hidden season or perk condition')

    def test_authored_records_keep_unique_ids_and_names(self):
        self.assertGreater(len(self.records), 100)
        self.assertEqual(len({r.fid for r in self.records}), len(self.records))
        names = [r.editor_id() for r in self.records if r.editor_id()]
        self.assertEqual(len(names), len(set(names)))

    def test_every_authored_record_is_named_in_the_plugin_description(self):
        description, unnamed = CONTENT.description_of([r.tag.decode() + ' ' + r.editor_id() for r in self.records])
        self.assertEqual(unnamed, [])
        self.assertLessEqual(len(description)+1, CONTENT.DESCRIPTION_MOST)

    def test_the_proven_bottle_maker_no_longer_needs_a_missing_maker_exception(self):
        waiting = json.loads((ROOT/'scripts/dev/Check-Makers.waiting.json').read_text())['items']
        self.assertFalse([r for r in waiting if r['desc'] == 'f2012:Skyrim.esm'])


if __name__ == '__main__':
    unittest.main()
