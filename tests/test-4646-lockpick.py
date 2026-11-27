"""test-4646-lockpick.py

    python tests/test-4646-lockpick.py

#4646: lockpicks came only from dungeon and body loot, and no recipe made
one. Thornswood-Content.esp now carries a forge recipe that makes several of
Skyrim's own Lockpick from one iron ingot, and the recipe table gives it to the
Edgewright. Held here, from the writer itself (no game, no network):

  1. scripts/mods/Add-ContentRecords.py writes one ThornswoodRecipeLockpick:
     one iron ingot in, Skyrim's Lockpick (a:Skyrim.esm) out, at the forge,
     more than one made, no condition hiding it.
  2. Its form id is new to the plugin, and the plugin's description still
     names every record it writes, inside its 512 bytes.
  3. records/recipe-owners.json gives it to the Smith's Edgewright half.
  4. Check-Makers.waiting.json no longer lists the lockpick as waiting for a
     maker, since the forge makes it once the box builds this.
"""
import importlib.util
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('content', ROOT / 'scripts/mods/Add-ContentRecords.py')
CONTENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTENT)
NAME = 'ThornswoodRecipeLockpick'
SKYRIM_LOCKPICK = 0x0000000A
IRON_INGOT = 0x0005ACE4
FORGE = 0x00088105


class Lockpick(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = CONTENT.thornswood_records(CONTENT.clam01(), []) + CONTENT.seasonal_records()

    def test_1_the_forge_makes_several_lockpicks_from_one_iron_ingot(self):
        matches = [r for r in self.records if r.editor_id() == NAME]
        self.assertEqual(len(matches), 1, 'the writer must emit one lockpick recipe')
        raw = matches[0].bytes()
        self.assertEqual(raw[:4], b'COBJ')
        fields = list(CONTENT.subrecords(raw[24:]))
        self.assertEqual([b for t, b in fields if t == b'CNAM'], [struct.pack('<I', SKYRIM_LOCKPICK)])
        self.assertEqual([b for t, b in fields if t == b'BNAM'], [struct.pack('<I', FORGE)])
        self.assertEqual([b for t, b in fields if t == b'COCT'], [struct.pack('<I', 1)])
        self.assertEqual([b for t, b in fields if t == b'CNTO'], [struct.pack('<II', IRON_INGOT, 1)])
        made = [struct.unpack('<H', b)[0] for t, b in fields if t == b'NAM1']
        self.assertEqual(made, [CONTENT.LOCKPICKS_MADE])
        self.assertGreater(CONTENT.LOCKPICKS_MADE, 1, 'several picks from one ingot')
        self.assertFalse([b for t, b in fields if t == b'CTDA'], 'no condition hides it')

    def test_2_its_id_is_new_and_the_description_still_names_everything(self):
        self.assertEqual(len({r.fid for r in self.records}), len(self.records))
        description, unnamed = CONTENT.description_of([r.tag.decode() + ' ' + r.editor_id() for r in self.records])
        self.assertEqual(unnamed, [])
        self.assertLessEqual(len(description) + 1, CONTENT.DESCRIPTION_MOST)

    def test_3_the_edgewright_owns_it(self):
        owners = json.loads((ROOT / 'records/recipe-owners.json').read_text(encoding='utf-8'))['owner']
        self.assertEqual((owners[NAME]['Owner'], owners[NAME]['Half']), ('Smith', 'Edgewright'))

    def test_4_the_lockpick_no_longer_waits_for_a_maker(self):
        waiting = json.loads((ROOT / 'scripts/dev/Check-Makers.waiting.json').read_text(encoding='utf-8'))['items']
        self.assertFalse([r for r in waiting if r['desc'] == 'a:Skyrim.esm'])


if __name__ == '__main__':
    unittest.main()
