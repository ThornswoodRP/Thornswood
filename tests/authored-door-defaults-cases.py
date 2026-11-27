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


RULES = {'protectedCells': {'200:Skyrim.esm': 'Creation'},
         'protectedDoors': {'301:Skyrim.esm': 'Custom quest'}}


def activation_world(change=None):
    rows = {
        0x101: [(b'XAPD', b'\1'), (b'XAPR', PACK(0x401, 0x3f800000)),
                (b'XAPR', PACK(0x402, 0x40000000))],
        0x102: [(b'XLOC', bytes(20)), (b'XAPD', b'\1')],
        0x103: [(b'XAPD', b'\0')],
        0x104: [(b'XLOC', bytes(20)), (b'XAPD', b'\0')],
        0x105: [(b'XAPD', b'\1')],  # An ACTI, never a door candidate.
        0x201: [(b'XAPD', b'\1')],
        0x301: [(b'XAPD', b'\1')],
    }
    if change:
        change(rows)
    groups = [F.group(b'DOOR', 0, F.record(b'DOOR', 0x500, [])),
              F.group(b'ACTI', 0, F.record(b'ACTI', 0x501, []))]
    cells = []
    for cell in (0x100, 0x200, 0x300):
        refs = b''.join(F.record(b'REFR', ref,
                               [(b'NAME', PACK(0x501 if ref == 0x105 else 0x500))] + pairs +
                               [(b'DATA', bytes(24))])
                        for ref, pairs in rows.items() if ref & 0xff00 == cell)
        cells.append(F.record(b'CELL', cell, [(b'DATA', b'\1\0')]) +
                     F.group(PACK(cell), 6, F.group(PACK(cell), 8, refs)))
    groups.append(F.group(b'CELL', 0, F.group(PACK(0), 2, F.group(PACK(0), 3, b''.join(cells)))))
    src = L.read_plugin(F.plugin(groups, []), 'Skyrim.esm', 0)
    return [src], L.winners([src], {b'REFR', b'DOOR', b'ACTI', b'CELL'})


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

    def test_copy_clears_parent_only_flag_and_preserves_link_ordinals_and_delay(self):
        plugins, _ = world()
        numbers = L.Renumber()
        numbers.masters = ['test.esm', 'skyrim.esm']
        pairs = [(b'XAPD', b'\1'), (b'XAPR', PACK(0x123, 0x3f800000)),
                 (b'XLKR', PACK(0x234, 0x345)), (b'XLRT', PACK(0x456, 0, 0x567)),
                 (b'XLRL', PACK(0x678)), (b'XTNM', PACK(0x789))]
        self.assertEqual(L.authored_doors.copy_pairs(plugins[0], pairs, numbers),
                         [(b'XAPD', b'\0'), (b'XAPR', PACK(0x1000123, 0x3f800000)),
                          (b'XLKR', PACK(0x1000234, 0x1000345)),
                          (b'XLRT', PACK(0x1000456, 0, 0x1000567)),
                          (b'XLRL', PACK(0x1000678)), (b'XTNM', PACK(0x1000789))])

    def test_selects_xapd_only_combined_and_locked_zero_but_not_unrestricted_or_acti(self):
        plugins, winners = activation_world()
        protected = []
        chosen = L.authored_doors.entries(plugins, winners, RULES, L.subrecords, protected=protected)
        self.assertEqual([e.fid for e in chosen], [0x101, 0x102, 0x104])
        self.assertEqual(protected, [('skyrim.esm', 0x201), ('skyrim.esm', 0x301)])

    def test_unknown_activation_size_value_and_duplicate_refuse_with_and_without_lock(self):
        for flags in ([b''], [b'\2'], [b'\1\0'], [b'\1', b'\0']):
            for lock in ([], [(b'XLOC', bytes(20))]):
                with self.subTest(flags=flags, lock=bool(lock)), self.assertRaisesRegex(SystemExit, 'XAPD'):
                    plugins, winners = activation_world(lambda rows: rows.update({
                        0x101: lock + [(b'XAPD', value) for value in flags]}))
                    L.authored_doors.entries(plugins, winners, RULES, L.subrecords)
                with self.subTest(copy=flags), self.assertRaisesRegex(SystemExit, 'XAPD'):
                    numbers = L.Renumber(); numbers.masters = ['skyrim.esm']
                    L.authored_doors.copy_pairs(plugins[0], lock + [(b'XAPD', value) for value in flags], numbers)

    def test_zero_activation_field_is_byte_identical_and_not_a_standalone_override(self):
        plugins, winners = activation_world()
        src = plugins[0]
        numbers = L.Renumber(); numbers.masters = ['skyrim.esm']
        entry = winners[(b'REFR', ('skyrim.esm', 0x103))]
        pairs = L.subrecords(src.data(entry))
        self.assertEqual(L.authored_doors.copy_pairs(src, pairs, numbers), pairs)

    def test_winning_clear_or_deleted_reference_is_not_overridden_from_an_older_source(self):
        plugins, _ = activation_world()
        refs = F.record(b'REFR', 0x101, [(b'NAME', PACK(0x500)), (b'XAPD', b'\0'), (b'DATA', bytes(24))])
        deleted = bytearray(F.record(b'REFR', 0x102, [(b'NAME', PACK(0x500)), (b'XAPD', b'\1')]))
        struct.pack_into('<I', deleted, 8, 0x20)
        body = F.group(b'CELL', 0, F.group(PACK(0), 2, F.group(PACK(0), 3,
                       F.record(b'CELL', 0x100, [(b'DATA', b'\1\0')]) +
                       F.group(PACK(0x100), 6, F.group(PACK(0x100), 8, refs + deleted)))))
        plugins.append(L.read_plugin(F.plugin([body], ['Skyrim.esm']), 'Winning.esp', 1))
        winners = L.winners(plugins, {b'REFR', b'DOOR', b'ACTI', b'CELL'})
        self.assertEqual([e.fid for e in L.authored_doors.entries(plugins, winners, RULES, L.subrecords)], [0x104])

    def test_foreign_activator_flag_is_not_interpreted_and_protected_unknown_fields_are_not_copied(self):
        plugins, winners = activation_world(lambda rows: rows.update({
            0x105: [(b'XAPD', b'\2\3')], 0x201: [(b'XAPD', b'\2\3'), (b'ZZZZ', bytes(7))]}))
        self.assertEqual([e.fid for e in L.authored_doors.entries(plugins, winners, RULES, L.subrecords)],
                         [0x101, 0x102, 0x104])

    def test_existing_override_cannot_silently_leave_parent_only_activation(self):
        plugins, winners = activation_world()
        with self.assertRaisesRegex(SystemExit, 'existing override'):
            L.authored_doors.entries(plugins, winners, RULES, L.subrecords,
                                     handled={('skyrim.esm', 0x101)})

    def test_summary_keeps_lock_removal_and_direct_activation_lists_distinct(self):
        plugins, winners = activation_world()
        chosen = L.authored_doors.entries(plugins, winners, RULES, L.subrecords)
        summary = L.authored_doors.summary(plugins, chosen, L.subrecords,
                                          lambda gid: '%x:%s' % (gid[1], gid[0]))
        self.assertEqual(summary, {'authoredDoorsUnlocked': ['102:skyrim.esm', '104:skyrim.esm'],
                                   'authoredDoorsDirectActivation': ['101:skyrim.esm', '102:skyrim.esm']})

    def test_real_serializer_recipe_roundtrip_preserves_parents_protection_and_xapr_ordinals(self):
        plugins, source_win = activation_world()
        src = plugins[0]
        chosen = L.authored_doors.entries(plugins, source_win, RULES, L.subrecords)
        numbers = L.Renumber(); numbers.masters = ['skyrim.esm']
        made = {'achr': [], 'refr': [], 'cell': {}, 'wrld': {}, 'qust': [], 'lctn': [], 'cobj': [], 'alch': []}
        for entry in chosen:
            pairs = L.authored_doors.copy_pairs(src, L.subrecords(src.data(entry)), numbers)
            made['refr'].append((entry.fid, entry.flags, L.pack_subrecords(pairs), entry))
            cell = src.gid(entry.ctx[1]); ce = source_win[(b'CELL', cell)]
            made['cell'][cell] = (ce.fid, ce.flags, src.data(ce), ce)
        final = L.read_plugin(L.write_plugin(made, ['Skyrim.esm'], plugins, numbers), 'Thornswood-Last.esp', 1)
        recipe, _ = L.make_recipe(final.buf, made, plugins)
        self.assertEqual(L.last_recipe.apply(recipe, lambda name: src.buf, lambda name: None), final.buf)
        plugins.append(final)
        winners = L.winners(plugins, {b'REFR', b'DOOR', b'ACTI', b'CELL'})
        def verify(rows=winners):
            return L.authored_doors.verify(plugins, source_win, rows, final, RULES, L.subrecords, numbers)
        self.assertEqual(verify(), [])
        ref = winners[(b'REFR', ('skyrim.esm', 0x101))]
        self.assertEqual([pair for pair in L.subrecords(final.data(ref)) if pair[0] in (b'XAPD', b'XAPR')],
                         [(b'XAPD', b'\0'), (b'XAPR', PACK(0x401, 0x3f800000)),
                          (b'XAPR', PACK(0x402, 0x40000000))])
        for fid in (0x103, 0x105, 0x201, 0x301):
            actual, original = winners[b'REFR', ('skyrim.esm', fid)], source_win[b'REFR', ('skyrim.esm', fid)]
            self.assertEqual((actual.pi, actual.fid, actual.off), (original.pi, original.fid, original.off))
        for fid in (0x101, 0x102, 0x104):
            missing = dict(winners); missing[b'REFR', ('skyrim.esm', fid)] = source_win[b'REFR', ('skyrim.esm', fid)]
            self.assertTrue(verify(missing))
        replaced_protected = dict(winners)
        replaced_protected[b'REFR', ('skyrim.esm', 0x201)] = ref
        self.assertTrue(verify(replaced_protected))
        corrupted = dict(made)
        corrupted['refr'] = [(fid, flags,
                              L.pack_subrecords([(tag, b'\1' if tag == b'XAPD' else body)
                                                 for tag, body in L.subrecords(data)]) if fid == 0x101 else data,
                              entry) for fid, flags, data, entry in made['refr']]
        bad_last = L.read_plugin(L.write_plugin(corrupted, ['Skyrim.esm'], [src], numbers),
                                 'Thornswood-Last.esp', 1)
        bad_plugins = [src, bad_last]
        bad_win = L.winners(bad_plugins, {b'REFR', b'DOOR', b'ACTI', b'CELL'})
        failures = L.authored_doors.verify(bad_plugins, source_win, bad_win, bad_last,
                                           RULES, L.subrecords, numbers)
        self.assertTrue(any('retains an authored lock or parent-only activation' in failure for failure in failures))


if __name__ == '__main__':
    unittest.main(verbosity=2)
