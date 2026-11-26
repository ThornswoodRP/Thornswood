"""Release content must contain all 88 usable Last overrides and safe shells.

Run locally or on the content box after building both own plugins. Last is
shipped only as a recipe, so hosted gates use the source-stage controls and
the complete generated recipe catalogue instead. The Last builder separately
verifies every byte against the original winning COBJ.
"""
import importlib.util
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/mods'))
spec = importlib.util.spec_from_file_location('last_4610_compiled', ROOT / 'scripts/mods/Build-LastPlugin.py')
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)


def read_json(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


class Compiled(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.groups = read_json('game/data/food-groups.json')
        cls.rows = L.seasoned_recipe_rows(cls.groups)
        cls.recipes = read_json('game/data/recipes.json')['recipes']
        cls.manifest = read_json('game/data/last-plugin.json')
        cls.content = L.read_plugin((ROOT / 'game/content/Thornswood-Content.esp').read_bytes(), L.CONTENT, 0)
        cls.last = L.read_plugin((ROOT / 'game/content/Thornswood-Last.esp').read_bytes(), L.PLUGIN, 1)
        cls.shells = {cls.content.gid(e.fid): e for e in cls.content.walk({b'COBJ'})}
        cls.final = {cls.last.gid(e.fid): e for e in cls.last.walk({b'COBJ'})}

    def test_exact_coverage_and_five_master_disabled_shells(self):
        self.assertEqual(len(self.groups['season']['recipes']), 44)
        self.assertEqual(len(self.rows), 88)
        self.assertEqual(self.content.masters, ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'])
        self.assertEqual({r['recipe'] for r in self.manifest['seasonedRecipes']}, {r['recipe'] for r in self.rows})
        for row in self.rows:
            with self.subTest(recipe=row['recipe']):
                shell = self.shells[L.ref_key(row['recipe'])]
                pairs = L.subrecords(self.content.data(shell)); data = dict(pairs)
                self.assertEqual(data[b'BNAM'], struct.pack('<I', 0))
                self.assertIn((b'CTDA', L.NEVER_TRUE), pairs)
                self.assertFalse(any(t == b'CNTO' for t, _ in pairs))
                self.assertEqual(self.content.gid(struct.unpack('<I', data[b'CNAM'])[0]), L.ref_key(row['item']))

    def test_all_winning_native_recipes_match_original_inputs_yield_and_unique_ids(self):
        editor_ids = set()
        rn = L.Renumber(); rn.masters = [n.lower() for n in self.last.masters]
        by_source = {}
        for row in self.rows:
            with self.subTest(recipe=row['recipe']):
                record = self.final[L.ref_key(row['recipe'])]
                pairs = L.subrecords(self.last.data(record)); data = dict(pairs)
                expected_id = ('ThornswoodRecipeSeasoned' + row['item'].split(':')[0]).encode() + b'\0'
                self.assertEqual(data[b'EDID'], expected_id)
                self.assertNotIn(expected_id, editor_ids); editor_ids.add(expected_id)
                self.assertEqual(self.last.gid(struct.unpack('<I', data[b'CNAM'])[0]), L.ref_key(row['item']))
                self.assertEqual(self.last.gid(struct.unpack('<I', data[b'BNAM'])[0]), L.ref_key('a5cb3:Skyrim.esm'))
                base = self.recipes[row['source']]
                self.assertEqual(struct.unpack('<H', data[b'NAM1'])[0], base['makes'])
                expected = {L.ref_key(i['item']): i['count'] for i in base['inputItems']}
                extra = L.ref_key(row['extra']); expected[extra] = expected.get(extra, 0) + 1
                inputs = [b for t, b in pairs if t == b'CNTO']
                self.assertEqual(len(inputs), struct.unpack('<I', data[b'COCT'])[0])
                actual = {self.last.gid(struct.unpack_from('<I', b)[0]): struct.unpack_from('<i', b, 4)[0] for b in inputs}
                self.assertEqual(len(actual), len(inputs))
                self.assertEqual(actual, expected)
                conditions = [b for t, b in pairs if t == b'CTDA']
                self.assertNotIn(L.NEVER_TRUE, conditions)
                self.assertFalse(L.perk_tests(pairs)[0])
                if row['source'] in by_source:
                    self.assertEqual(conditions, by_source[row['source']])
                by_source[row['source']] = conditions
                # Every native form reference must fit this plugin's masters.
                L.copy_record(self.last, record, rn, lambda *_: None, row['recipe'])

    def test_missing_final_patch_does_not_fall_back_to_a_craftable_recipe(self):
        # Remove Last only in this in-memory winner map. Content alone has no
        # bench and an always-false condition for every planned recipe.
        self.assertEqual(len({L.ref_key(r['recipe']) for r in self.rows} & set(self.final)), 88)
        for row in self.rows:
            shell = dict(L.subrecords(self.content.data(self.shells[L.ref_key(row['recipe'])])))
            self.assertEqual(shell[b'BNAM'], b'\0' * 4)
            self.assertEqual(shell[b'CTDA'], L.NEVER_TRUE)


if __name__ == '__main__':
    unittest.main()
