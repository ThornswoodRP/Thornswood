"""#4790: River Water is a record of its own in the content plugin.

The client names what it drinks by record alone, so where a bottle's water
came from has to be the bottle's record for it to go with the bottle. The
water bucket fills River Water (NEEDS.waterItems.river in the gamemode),
and this checks the content builder writes that record, at the form id the
gamemode names, wearing the look it reads from the masters, worth nothing,
with its one effect saying what the server does, and named in the plugin's
description. Read only: the masters are a stand-in.
"""
import importlib.util
from pathlib import Path
import re
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('content', ROOT/'scripts/mods/Add-ContentRecords.py')
CONTENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTENT)

LOOK = [(b'OBND', b'\x01' * 12), (b'MODL', b'Clutter\\Mead.nif\x00'), (b'DATA', struct.pack('<f', 0.5)),
        (b'ENIT', struct.pack('<iIIfI', 5, 0, 0, 0.0, 0x000CAF94))]


class RiverWater(unittest.TestCase):
    def records(self, look):
        seen = []

        def fake(masters_dir, desc, plugin_masters, problems):
            seen.append(desc)
            if look is None:
                problems.append('%s cannot be read' % desc)
            return look
        real = CONTENT.dish_look
        CONTENT.dish_look = fake
        try:
            problems = []
            out = CONTENT.river_water_records('masters', CONTENT.PLUGIN_MASTERS, problems)
        finally:
            CONTENT.dish_look = real
        return out, problems, seen

    def test_the_record_is_where_the_gamemode_looks(self):
        gm = (ROOT/'game/gamemode/needs.ts').read_text(encoding='utf-8')
        named = re.search(r"river: '([0-9a-f]+):Thornswood-Content\.esp'", gm)
        self.assertIsNotNone(named, 'NEEDS.waterItems names river water in the content plugin')
        self.assertEqual(int(named.group(1), 16), CONTENT.RIVER_WATER & 0xFFFFFF)

    def test_it_wears_the_mead_bottle_and_is_worth_nothing(self):
        out, problems, seen = self.records(LOOK)
        self.assertEqual(problems, [])
        self.assertEqual(seen, [CONTENT.RIVER_WATER_LOOK])
        alch = [r for r in out if r.tag == b'ALCH']
        self.assertEqual(len(alch), 1)
        fields = dict(CONTENT.subrecords(alch[0].bytes()[24:]))
        self.assertEqual(alch[0].fid, CONTENT.RIVER_WATER)
        self.assertEqual(fields[b'FULL'], b'River Water\x00')
        self.assertEqual(fields[b'MODL'], b'Clutter\\Mead.nif\x00')
        self.assertEqual(struct.unpack('<iIIfI', fields[b'ENIT']), (0, 0x3, 0, 0.0, 0x000CAF94))
        self.assertEqual(fields[b'EFID'], struct.pack('<I', CONTENT.RIVER_WATER_EFFECT))

    def test_a_look_that_cannot_be_read_makes_nothing_and_says_so(self):
        out, problems, _ = self.records(None)
        self.assertEqual(out, [])
        self.assertEqual(len(problems), 1)

    def test_both_records_are_named_in_the_plugin_description(self):
        out, _, _ = self.records(LOOK)
        _, unnamed = CONTENT.description_of([r.tag.decode() + ' ' + r.editor_id() for r in out])
        self.assertEqual(unnamed, [])

    def test_the_build_writes_them_with_the_records_read_from_the_masters(self):
        src = (ROOT/'scripts/mods/Add-ContentRecords.py').read_text(encoding='utf-8')
        self.assertIn('water_made = river_water_records(args.masters, plugin_masters, problems)', src)
        self.assertIn('records = own + house + wood + quality_made + seasoned_made + water_made', src)


if __name__ == '__main__':
    unittest.main()
