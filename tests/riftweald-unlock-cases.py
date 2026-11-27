"""Offline record controls for the exact obsolete Riftweald locks, no game files."""
import importlib.util
import json
import pathlib
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/dev'))


def sub(tag, body):
    return tag + struct.pack('<H', len(body)) + body


def record(tag, fid, pairs, flags=0):
    body = b''.join(sub(*p) for p in pairs)
    return tag + struct.pack('<IIIIHH', len(body), flags, fid, 0, 44, 0) + body


def group(label, kind, body):
    return b'GRUP' + struct.pack('<I', len(body) + 24) + label + struct.pack('<iII', kind, 0, 0) + body


def plugin(groups, masters=()):
    header = [(b'HEDR', struct.pack('<fII', 1.7, 0, 0x800))]
    for name in masters:
        header += [(b'MAST', name.encode() + b'\0'), (b'DATA', bytes(8))]
    return record(b'TES4', 0, header) + b''.join(groups)


POLICY = {'riftwealdUnlocked': {'door': '27eed:Skyrim.esm',
    'bars': ['9401e:Skyrim.esm', '94020:Skyrim.esm', '94023:Skyrim.esm']}}


def door_pairs(outer=True):
    return ([(b'EDID', b'TG07BackDoorRef\0'), (b'NAME', struct.pack('<I', 0x94025)),
             (b'XTEL', struct.pack('<I', 0x270cf) + bytes(28)),
             (b'XLOC', struct.pack('<B3xI', 75, 0x72b05) + bytes(12)),
             (b'XNDP', bytes(8)), (b'DATA', bytes(24))] if outer else
            [(b'EDID', b'RiftwealdToBackBalconyLoad\0'), (b'NAME', struct.pack('<I', 0x4d6ed)),
             (b'XTEL', struct.pack('<I', 0x27eed) + bytes(28)),
             (b'XNDP', bytes(8)), (b'DATA', bytes(24))])


class TableTests(unittest.TestCase):
    def test_actual_table_only_removes_verified_lock(self):
        with tempfile.TemporaryDirectory(prefix='tw-riftweald-') as tmp:
            path = pathlib.Path(tmp)
            data = path / 'Data'
            data.mkdir()
            bases = group(b'DOOR', 0, b''.join(record(b'DOOR', fid, []) for fid in (0x94025, 0x4d6ed)))
            def cell(fid, refs):
                return (record(b'CELL', fid, [(b'EDID', b'Test\0'), (b'DATA', b'\1')]) +
                        group(struct.pack('<I', fid), 6, b''.join(refs)))
            protected = [(b'NAME', struct.pack('<I', 0x94025)),
                         (b'XTEL', struct.pack('<I', 0x270cf)),
                         (b'XLOC', struct.pack('<B3xI', 255, 0) + bytes(12))]
            cells = group(b'CELL', 0, cell(0x16be0, [record(b'REFR', 0x27eed, door_pairs()),
                        record(b'REFR', 0x40fa0, protected)]) +
                        cell(0x37cc6, [record(b'REFR', 0x270cf, door_pairs(False))]))
            (data / 'Skyrim.esm').write_bytes(plugin([bases, cells]))
            for master in ('Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'):
                (data / master).write_bytes(plugin([]))
            (path / 'plugins.txt').write_text('')
            (path / 'policy.json').write_text(json.dumps(POLICY))
            args = [sys.executable, str(ROOT / 'scripts/dev/Build-DoorTable.py'),
                    '--data', str(data), '--plugins', str(path / 'plugins.txt'),
                    '--policy', str(path / 'policy.json'), '--out', str(path / 'doors.json'),
                    '--tables', str(path / 'tables')]
            result = subprocess.run(args, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            rows = json.loads((path / 'doors.json').read_text())['doors']
            self.assertNotIn('lock', rows['27eed:Skyrim.esm'])
            self.assertEqual(rows['40fa0:Skyrim.esm']['lock']['level'], 255)
            self.assertEqual(rows['27eed:Skyrim.esm']['to'], '270cf:Skyrim.esm')
            # Last is excluded by the real builder, so a second pass cannot change the table.
            before = (path / 'doors.json').read_bytes()
            (path / 'plugins.txt').write_text('*Thornswood-Last.esp\n')
            again = subprocess.run(args, capture_output=True, text=True, timeout=20)
            self.assertEqual(again.returncode, 0, again.stdout + again.stderr)
            self.assertEqual(before, (path / 'doors.json').read_bytes())
            # Changed ownership or metadata must refuse before replacing the existing output.
            for bad in (dict(POLICY['riftwealdUnlocked'], door='40fa0:Skyrim.esm'),
                        dict(POLICY['riftwealdUnlocked'], door='123:Thornswood-Content.esp')):
                (path / 'policy.json').write_text(json.dumps({'riftwealdUnlocked': bad}))
                refusal = subprocess.run(args, capture_output=True, text=True, timeout=20)
                self.assertNotEqual(refusal.returncode, 0)
                self.assertEqual(before, (path / 'doors.json').read_bytes())
            (path / 'policy.json').write_text(json.dumps(POLICY))
            master = data / 'Skyrim.esm'
            master.write_bytes(master.read_bytes().replace(struct.pack('<I', 0x72b05), struct.pack('<I', 0x72b06)))
            refusal = subprocess.run(args, capture_output=True, text=True, timeout=20)
            self.assertNotEqual(refusal.returncode, 0)
            self.assertEqual(before, (path / 'doors.json').read_bytes())


class RecordTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('last_riftweald', ROOT / 'scripts/mods/Build-LastPlugin.py')
        cls.last = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.last)

    def source(self, change=None):
        last = self.last
        tree = {'ver': 5, 'fmt': 2, 'scripts': [{'name': b'TG07BarScript', 'status': 0,
            'props': [{'name': b'pMessage', 'type': 1, 'status': 1,
                       'value': {'fid': 0x94021, 'alias': -1, 'unused': 0}}]}], 'quest': None, 'rest': b''}
        pairs = {0x27eed: door_pairs(), 0x270cf: door_pairs(False),
                 0x9401f: [(b'EDID', b'TG07DoorBoltSecured\0'), (b'VMAD', last.vmad_write(tree))]}
        for fid in (0x9401e, 0x94020, 0x94023):
            pairs[fid] = [(b'NAME', struct.pack('<I', 0x9401f)),
                          (b'XSCL', struct.pack('<f', 1)), (b'DATA', bytes(24))]
        if change:
            change(pairs)
        def cell(fid, refs):
            body = record(b'CELL', fid, [(b'DATA', b'\1')])
            body += group(struct.pack('<I', fid), 6, group(struct.pack('<I', fid), 8,
                          b''.join(record(b'REFR', ref, pairs[ref], 0x40000000 if ref == 0x9401e else 0)
                                   for ref in refs)))
            return group(struct.pack('<i', 0), 2, group(struct.pack('<i', 0), 3, body))
        body = plugin([group(b'DOOR', 0, record(b'DOOR', 0x94025, []) + record(b'DOOR', 0x4d6ed, [])),
                       group(b'ACTI', 0, record(b'ACTI', 0x9401f, pairs[0x9401f])),
                       group(b'CELL', 0, cell(0x16be0, [0x27eed]) +
                             cell(0x37cc6, [0x270cf, 0x9401e, 0x94020, 0x94023]))])
        src = last.read_plugin(body, 'Skyrim.esm', 0)
        return src, last.winners([src], {b'REFR', b'DOOR', b'ACTI', b'CELL'})

    def test_actual_parser_selects_only_the_four_reviewed_records(self):
        src, win = self.source()
        chosen = self.last.riftweald.entries([src], win, POLICY, self.last.subrecords, self.last.vmad_parse)
        self.assertEqual([(e.fid, kind) for e, kind in chosen],
                         [(0x27eed, 'door'), (0x9401e, 'bar'), (0x94020, 'bar'), (0x94023, 'bar')])
        self.assertNotIn(0x270cf, [e.fid for e, _ in chosen])

    def test_changed_winning_record_or_bar_script_contract_refuses(self):
        def replace(pairs, fid, tag, value):
            pairs[fid] = [(t, value if t == tag else b) for t, b in pairs[fid]]
        changes = [lambda p: replace(p, 0x27eed, b'NAME', struct.pack('<I', 0x94026)),
                   lambda p: replace(p, 0x270cf, b'XTEL', struct.pack('<I', 0x27eec) + bytes(28)),
                   lambda p: replace(p, 0x94020, b'NAME', struct.pack('<I', 0x94022)),
                   lambda p: replace(p, 0x9401f, b'VMAD', dict(p[0x9401f])[b'VMAD'].replace(b'TG07BarScript', b'TW07BarScript')),
                   lambda p: p[0x94023].append((b'XESP', bytes(8))),
                   lambda p: p[0x27eed].append((b'VMAD', bytes(8)))]
        for change in changes:
            with self.subTest(change=changes.index(change)), self.assertRaises(SystemExit):
                src, win = self.source(change)
                self.last.riftweald.entries([src], win, POLICY, self.last.subrecords, self.last.vmad_parse)

    def test_incoming_parent_links_and_custom_quest_references_refuse(self):
        last = self.last
        src, _ = self.source()
        tree = {'ver': 5, 'fmt': 2, 'scripts': [{'name': b'ThornswoodQuest', 'status': 0,
                'props': [{'name': b'ProtectedDoor', 'type': 1, 'status': 1,
                           'value': {'fid': 0x27eed, 'alias': -1, 'unused': 0}}]}],
                'quest': {'unk': 2, 'frags': [], 'file': b'', 'aliases': []}, 'rest': b''}
        cases = [(b'REFR', [(b'NAME', struct.pack('<I', 0x9401f)), (b'XESP', struct.pack('<II', 0x94020, 0))]),
                 (b'REFR', [(b'NAME', struct.pack('<I', 0x9401f)), (b'XLKR', struct.pack('<II', 0, 0x94020))]),
                 (b'QUST', [(b'ALFR', struct.pack('<I', 0x27eed))]),
                 (b'QUST', [(b'VMAD', last.vmad_write(tree))])]
        for tag, pairs in cases:
            with self.subTest(tag=tag, fields=[t for t, _ in pairs]), self.assertRaises(SystemExit):
                extra = last.read_plugin(plugin([group(tag, 0, record(tag, 0x1000042, pairs))], ['Skyrim.esm']),
                                         'Thornswood-Content.esp', 1)
                plugins = [src, extra]
                win = last.winners(plugins, {b'REFR', b'DOOR', b'ACTI', b'QUST'})
                last.riftweald.entries(plugins, win, POLICY, last.subrecords, last.vmad_parse)

    def test_final_plugin_exact_copies_and_negative_missing_or_corrupt_overrides(self):
        last = self.last
        src, source_win = self.source()
        chosen = last.riftweald.entries([src], source_win, POLICY, last.subrecords, last.vmad_parse)
        numbers = last.Renumber()
        numbers.masters = ['skyrim.esm']
        made = {'achr': [], 'refr': [], 'cell': {}, 'wrld': {}, 'qust': [], 'lctn': [], 'cobj': [], 'alch': []}
        for entry, kind in chosen:
            pairs = last.riftweald.copy_pairs(src, last.subrecords(src.data(entry)), numbers, kind)
            flags = entry.flags | (0x800 if kind == 'bar' else 0)
            made['refr'].append((entry.fid, flags, last.pack_subrecords(pairs), entry))
            cell = src.gid(entry.ctx[1])
            ce = source_win[(b'CELL', cell)]
            made['cell'][cell] = (ce.fid, ce.flags, src.data(ce), ce)
        final = last.read_plugin(last.write_plugin(made, ['Skyrim.esm'], [src], numbers), 'Thornswood-Last.esp', 1)
        recipe, _ = last.make_recipe(final.buf, made, [src])
        self.assertEqual(last.last_recipe.apply(recipe, lambda name: src.buf, lambda name: None), final.buf)
        plugins = [src, final]
        win = last.winners(plugins, {b'REFR'})
        manifest = {'riftwealdUnlocked': list(last.riftweald.policy_refs(POLICY))}
        def verify(rows=win, receipt=manifest):
            return last.riftweald.verify(plugins, source_win, rows, final, receipt, POLICY,
                                        last.subrecords, last.vmad_parse, numbers)
        self.assertEqual(verify(), [])
        for entry, _ in chosen:
            missing = dict(win)
            del missing[(b'REFR', src.gid(entry.fid))]
            self.assertTrue(verify(missing))
        self.assertTrue(verify(receipt={'riftwealdUnlocked': []}))
        bar = win[(b'REFR', ('skyrim.esm', 0x94020))]
        bar.flags &= ~0x800
        self.assertTrue(verify())
        bar.flags |= 0x800
        partner = win[(b'REFR', ('skyrim.esm', 0x270cf))]
        win[(b'REFR', ('skyrim.esm', 0x270cf))] = bar
        self.assertTrue(verify())
        win[(b'REFR', ('skyrim.esm', 0x270cf))] = partner
        self.assertEqual(verify(), [])

    def test_strict_policy_does_not_accept_other_quest_or_staff_targets(self):
        self.assertEqual(self.last.riftweald.policy_refs(POLICY), ('27eed:Skyrim.esm',
                         '9401e:Skyrim.esm', '94020:Skyrim.esm', '94023:Skyrim.esm'))
        for desc in ('40fa0:Skyrim.esm', '123:Thornswood-Content.esp'):
            with self.assertRaises(SystemExit):
                self.last.riftweald.policy_refs({'riftwealdUnlocked': dict(POLICY['riftwealdUnlocked'], door=desc)})

    def test_copy_only_drops_xloc_and_preserves_identity_position_and_teleport(self):
        class Source:
            name = 'Skyrim.esm'
        class Numbers:
            def one(self, source, fid, what):
                return fid + 0x01000000
        pairs = door_pairs()
        copied = self.last.riftweald.copy_pairs(Source(), pairs, Numbers(), 'door')
        self.assertEqual([t for t, _ in copied], [t for t, _ in pairs if t != b'XLOC'])
        for tag in (b'EDID', b'DATA'):
            self.assertEqual(dict(copied)[tag], dict(pairs)[tag])
        self.assertEqual(struct.unpack('<I', dict(copied)[b'NAME'])[0], 0x1094025)
        self.assertEqual(struct.unpack_from('<I', dict(copied)[b'XTEL'])[0], 0x10270cf)
        self.assertEqual(dict(copied)[b'XTEL'][4:], dict(pairs)[b'XTEL'][4:])

    def test_added_script_link_parent_or_unknown_field_stops_before_copy(self):
        for tag in (b'VMAD', b'XLKR', b'XESP', b'ZZZZ'):
            with self.subTest(tag=tag), self.assertRaises(SystemExit):
                self.last.riftweald.check_pairs(door_pairs() + [(tag, bytes(8))], 'door')

    def test_bar_copy_keeps_all_native_fields(self):
        class Numbers:
            def one(self, source, fid, what):
                return fid
        pairs = [(b'NAME', struct.pack('<I', 0x9401f)), (b'XSCL', struct.pack('<f', 1)), (b'DATA', bytes(24))]
        self.assertEqual(self.last.riftweald.copy_pairs(None, pairs, Numbers(), 'bar'), pairs)


if __name__ == '__main__':
    unittest.main(verbosity=2)
