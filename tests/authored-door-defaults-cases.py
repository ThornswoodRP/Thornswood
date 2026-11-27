"""Bulk authored door defaults, through the real record loader."""
import importlib.util
import pathlib
import struct
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load(file, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


L = load('scripts/mods/Build-LastPlugin.py', 'last_bulk_doors_fixture')
F = load('tests/riftweald-unlock-cases.py', 'bulk_door_fixture_helpers')
PACK = lambda *values: struct.pack('<' + 'I' * len(values), *values)


def world():
    doors = F.group(b'DOOR', 0, F.record(b'DOOR', 0x500, [(b'EDID', b'FixtureDoor\0')]))
    cell_group = []
    for cell, rows in [(0x100, [(0x101, 0x500), (0x102, 0x501), (0x103, 0x500)]),
                       (0x200, [(0x201, 0x500)]), (0x300, [(0x301, 0x500)])]:
        refs = b''
        for ref, base in rows:
            pairs = [(b'NAME', PACK(base)), (b'XOWN', PACK(0x900)), (b'DATA', bytes(24))]
            if ref != 0x103:
                pairs.append((b'XLOC', struct.pack('<B3xI', 75, 0x901) + bytes(12)))
            refs += F.record(b'REFR', ref, pairs)
        cell_group.append(F.record(b'CELL', cell, [(b'DATA', b'\1\0')]) +
                          F.group(PACK(cell), 6, F.group(PACK(cell), 8, refs)))
    cells = F.group(b'CELL', 0, F.group(PACK(0), 2, F.group(PACK(0), 3, b''.join(cell_group))))
    src = L.read_plugin(F.plugin([doors, cells], []), 'Skyrim.esm', 0)
    return [src], L.winners([src], {b'REFR', b'DOOR', b'CELL'})


class Defaults(unittest.TestCase):
    def test_selects_nonteleport_door_without_requiring_claim_map_or_key_allowlist(self):
        plugins, winners = world()
        entries = L.authored_doors.entries(plugins, winners, {
            'protectedCells': {'200:Skyrim.esm': 'Creation'},
            'protectedDoors': {'301:Skyrim.esm': 'Custom quest'},
        }, L.subrecords)
        self.assertEqual([entry.fid for entry in entries], [0x101])

    def test_copy_removes_only_lock_and_renumbers_door_and_owner(self):
        plugins, winners = world()
        src = plugins[0]
        entry = winners[(b'REFR', ('skyrim.esm', 0x101))]
        numbers = L.Renumber()
        numbers.masters = ['test.esm', 'skyrim.esm']
        result = L.authored_doors.copy_pairs(src, L.subrecords(src.data(entry)), numbers)
        self.assertEqual(result, [(b'NAME', PACK(0x1000500)), (b'XOWN', PACK(0x1000900)),
                                  (b'DATA', bytes(24))])

    def test_unknown_copy_fields_refuse_instead_of_dropping_or_copying_raw_ids(self):
        plugins, _ = world()
        numbers = L.Renumber()
        numbers.masters = ['skyrim.esm']
        with self.assertRaisesRegex(SystemExit, 'ZZZZ'):
            L.authored_doors.copy_pairs(plugins[0], [(b'ZZZZ', PACK(0x900))], numbers)

    def test_copy_preserves_activator_settings_and_remaps_both_link_ids(self):
        plugins, _ = world()
        numbers = L.Renumber()
        numbers.masters = ['test.esm', 'skyrim.esm']
        pairs = [(b'XAPD', b'\1'), (b'XAPR', PACK(0x123, 0x3f800000)),
                 (b'XLKR', PACK(0x234, 0x345)), (b'XLRT', PACK(0x456, 0, 0x567)),
                 (b'XLRL', PACK(0x678)), (b'XTNM', PACK(0x789))]
        self.assertEqual(L.authored_doors.copy_pairs(plugins[0], pairs, numbers),
                         [(b'XAPD', b'\1'), (b'XAPR', PACK(0x1000123, 0x3f800000)),
                          (b'XLKR', PACK(0x1000234, 0x1000345)),
                          (b'XLRT', PACK(0x1000456, 0, 0x1000567)),
                          (b'XLRL', PACK(0x1000678)), (b'XTNM', PACK(0x1000789))])


if __name__ == '__main__':
    unittest.main(verbosity=2)
