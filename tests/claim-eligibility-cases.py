"""Claim map expansion through the real compiler, with synthetic plugin bytes."""
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('claim_fixture_records', ROOT / 'tests/riftweald-unlock-cases.py')
F = importlib.util.module_from_spec(spec)
spec.loader.exec_module(F)
PACK = lambda value: struct.pack('<I', value)


def source():
    groups = [F.group(b'DOOR', 0, F.record(b'DOOR', 0x500, [(b'EDID', b'OrdinaryDoor\0')]))]
    rows = [(0x100, False, [(0x101, 0x201), (0x102, 0x202), (0x103, None), (0x104, 0x301), (0x701, 0x702), (0x901, 0xa01)]),
            (0x200, False, [(0x201, 0x101), (0x202, 0x102), (0xa01, 0x901)]),
            (0x300, True, [(0x301, 0x104), (0x302, None), (0x702, 0x701)]),
            (0x400, True, [(0x401, None)]), (0x600, True, [(0x601, None)])]
    children = []
    for cell, interior, refs in rows:
        records = b''
        for fid, far in refs:
            pairs = [(b'NAME', PACK(0x500)), (b'DATA', bytes(24))]
            if far:
                pairs.append((b'XTEL', PACK(far) + bytes(28)))
            records += F.record(b'REFR', fid, pairs)
        children.append(F.record(b'CELL', cell, [(b'DATA', bytes([int(interior), 0])),
                                               (b'FULL', ('Room %x\0' % cell).encode())]) +
                        F.group(PACK(cell), 6, F.group(PACK(cell), 8, records)))
    groups.append(F.group(b'CELL', 0, F.group(PACK(0), 2, F.group(PACK(0), 3, b''.join(children)))))
    groups.append(F.group(b'FACT', 0, F.record(b'FACT', 0x800, [(b'JAIL', PACK(0x701))])))
    return F.plugin(groups, [])


class Eligibility(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory(prefix='tw-7071-eligibility-')
        cls.addClassCleanup(cls.folder.cleanup)
        cls.path = Path(cls.folder.name)
        for name in ('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'):
            (cls.path / name).write_bytes(source() if name == 'Skyrim.esm' else F.plugin([], []))
        (cls.path / 'Thornswood-Last.esp').write_bytes(F.plugin([], []))
        (cls.path / 'plugins.txt').write_text('*Thornswood-Last.esp\n')
        (cls.path / 'last-plugin.json').write_text(json.dumps({'authoredDoorsUnlocked': []}))
        (cls.path / 'policy.json').write_text(json.dumps({'gatesUnlocked': {'gates': []},
            'authoredDoorDefaults': {'protectedCells': {'400:Skyrim.esm': 'Creation Hall'},
                                    'protectedDoors': {'401:Skyrim.esm': 'Creation Hall',
                                                       '901:Skyrim.esm': 'Thornswood quest door'}}}))
        cls.run_builder()

    @classmethod
    def run_builder(cls):
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/dev/Build-DoorTable.py'),
            '--data', str(cls.path), '--plugins', str(cls.path / 'plugins.txt'),
            '--policy', str(cls.path / 'policy.json'), '--out', str(cls.path / 'doors.json'),
            '--tables', str(cls.path / 'tables')], capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        cls.doc = json.loads((cls.path / 'doors.json').read_text())
        cls.tables = {name: json.loads((cls.path / 'tables' / (name + '.json')).read_text())
                      for name in ('BUILDING_BY_DOOR', 'BUILDING_NAME', 'WAY_OUT')}

    def mapped(self):
        return self.tables['BUILDING_BY_DOOR']

    def test_standalone_exterior_gate_is_claimable(self):
        self.assertIn('103:Skyrim.esm', self.mapped())

    def test_exterior_pairs_share_one_site_each_without_claiming_public_cell(self):
        m = self.mapped()
        self.assertEqual(m.get('101:Skyrim.esm'), m.get('201:Skyrim.esm'))
        self.assertEqual(m.get('102:Skyrim.esm'), m.get('202:Skyrim.esm'))
        self.assertIsNotNone(m.get('101:Skyrim.esm'))
        self.assertNotEqual(m.get('101:Skyrim.esm'), m.get('102:Skyrim.esm'))
        self.assertNotIn('100:Skyrim.esm', (m.get('101:Skyrim.esm'), m.get('103:Skyrim.esm')))

    def test_new_interior_without_teleport_ingress_is_claimable(self):
        self.assertEqual(self.mapped().get('601:Skyrim.esm'), '600:Skyrim.esm')

    def test_existing_home_identity_and_egress_are_preserved(self):
        m, out = self.mapped(), self.tables['WAY_OUT']
        self.assertEqual([m.get(x + ':Skyrim.esm') for x in ('104', '301', '302')], ['300:Skyrim.esm'] * 3)
        self.assertNotIn('104:Skyrim.esm', out)
        self.assertIn('301:Skyrim.esm', out)
        self.assertIn('302:Skyrim.esm', out)

    def test_new_ambiguous_routes_never_shut_someone_in(self):
        for fid in ('101', '102', '103', '201', '202', '601'):
            self.assertIn(fid + ':Skyrim.esm', self.tables['WAY_OUT'])

    def test_exact_hall_excluded_without_excluding_same_door_base(self):
        self.assertNotIn('401:Skyrim.esm', self.mapped())
        self.assertIn('103:Skyrim.esm', self.mapped())

    def test_exact_quest_door_cannot_be_claimed_from_its_other_face(self):
        self.assertNotIn('901:Skyrim.esm', self.mapped())
        self.assertNotIn('a01:Skyrim.esm', self.mapped())
        self.assertIn('103:Skyrim.esm', self.mapped())

    def test_unknown_parent_context_refuses_instead_of_claiming_a_public_cell(self):
        spec = importlib.util.spec_from_file_location('tested_claim_sites', ROOT / 'scripts/dev/claim_sites.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaisesRegex(ValueError, 'no actual parent CELL'):
            module.expand({}, {'101:Skyrim.esm': {'cell': '100:Skyrim.esm'}}, {}, {}, {}, {}, {})

    def test_actual_faction_jail_markers_are_not_physical_claim_routes(self):
        self.assertNotIn('701:Skyrim.esm', self.mapped())
        self.assertNotIn('702:Skyrim.esm', self.mapped())
        self.assertIn('302:Skyrim.esm', self.mapped())

    def test_declared_sites_and_served_names_have_identical_scope(self):
        self.assertEqual(set(self.doc['buildings']), set(self.tables['BUILDING_NAME']))
        self.assertEqual(set(self.mapped().values()), set(self.tables['BUILDING_NAME']))
        self.assertEqual(self.doc.get('sites', {}).get('103:Skyrim.esm', {}).get('kind'), 'standalone')

    def test_repeat_compilation_is_byte_identical(self):
        before = {p.name: p.read_bytes() for p in (self.path / 'tables').glob('*.json')}
        document = (self.path / 'doors.json').read_bytes()
        self.run_builder()
        self.assertEqual(before, {p.name: p.read_bytes() for p in (self.path / 'tables').glob('*.json')})
        self.assertEqual(document, (self.path / 'doors.json').read_bytes())

    def test_actual_claim_and_lock_routes_use_the_compiled_sites(self):
        result = subprocess.run(['node', str(ROOT / 'tests/claim-site-runtime.js'), str(self.path)],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        counts = json.loads(result.stdout)
        self.assertEqual(counts, {'claims': 4, 'refusedHijacks': 4, 'passableLeaves': 6})


if __name__ == '__main__':
    unittest.main(verbosity=2)
