"""Exact four-door policy, synthetic plugins and real compiler paths only."""
import copy
import hashlib
import importlib.util
import json
import pathlib
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value
R = module('rift_fixture_helpers', 'tests/riftweald-unlock-cases.py')
L = module('last_four_door_fixture', 'scripts/mods/Build-LastPlugin.py')
sub, record, group, plugin = R.sub, R.record, R.group, R.plugin
PLAN = {
    '5a7ea:Skyrim.esm': ('2834e:Skyrim.esm', '52a40:Skyrim.esm', '5ad3c:Skyrim.esm', 'd74:Skyrim.esm', '529dd:Skyrim.esm', 50),
    '501a7:Skyrim.esm': ('2834e:Skyrim.esm', '501a9:Skyrim.esm', '2834e:Skyrim.esm', 'd74:Skyrim.esm', '5015d:Skyrim.esm', 50),
    'cb8b9:Skyrim.esm': ('252c7:Skyrim.esm', 'cb8b8:Skyrim.esm', '252c7:Skyrim.esm', '1a270:Skyrim.esm', '165af:Skyrim.esm', 25),
    '24201:JKs Skyrim.esp': ('e9e08:Skyrim.esm', '241ef:JKs Skyrim.esp', 'e9e07:Skyrim.esm', 'd74:Skyrim.esm', '241f2:JKs Skyrim.esp', 50),
}
OWNERS = {'529dd:Skyrim.esm': None, '5015d:Skyrim.esm': '2c006:Skyrim.esm',
          '165af:Skyrim.esm': '93b1b:Skyrim.esm', '241f2:JKs Skyrim.esp': '135e9:Skyrim.esm',
          'd74:Skyrim.esm': None, '1a270:Skyrim.esm': None}
WANT = {b'REFR', b'DOOR', b'CELL', b'WRLD', b'ACTI', b'ACHR', b'QUST'}

def key(desc):
    fid, name = desc.split(':', 1)
    return name.lower(), int(fid, 16)

def fixture():
    names = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'JKs Skyrim.esp']
    def make(name):
        def fid(desc):
            value, owner = desc.split(':', 1)
            return int(value, 16) | (0x1000000 if owner == name and name != 'Skyrim.esm' else 0)
        placed = {}
        for ref, (base, pair, pairbase, outside, inside, level) in PLAN.items():
            if ref.split(':')[1] != name:
                continue
            for desc, usedbase, target, cell, lock in ((ref, base, pair, outside, level), (pair, pairbase, ref, inside, None)):
                pairs = [(b'NAME', struct.pack('<I', fid(usedbase))),
                         (b'XTEL', struct.pack('<I', fid(target)) + bytes(28))]
                if lock is not None:
                    pairs += [(b'XLOC', struct.pack('<B3xI', lock, 0) + bytes(12))]
                pairs += [(b'XNDP', bytes(8))]
                if name == 'JKs Skyrim.esp':
                    pairs += [(b'XSCL', struct.pack('<f', 0.8))]
                pairs += [(b'DATA', bytes(24))]
                placed.setdefault(cell, []).append(record(b'REFR', fid(desc), pairs, 0x400))
        if name == 'Skyrim.esm':
            # A non-target staff descriptor stays locked, with the same base.
            placed['d74:Skyrim.esm'].append(record(b'REFR', 0x40fa0,
                [(b'NAME', struct.pack('<I', 0x2834e)), (b'XTEL', struct.pack('<I', 0x52a40) + bytes(28)),
                 (b'XLOC', struct.pack('<B3xI', 255, 0) + bytes(12)), (b'DATA', bytes(24))]))
        interior, exterior = [], {}
        for cell, refs in placed.items():
            owner = OWNERS[cell]
            pairs = [(b'EDID', b'FixtureCell\0'), (b'DATA', b'\0\0' if cell in ('d74:Skyrim.esm', '1a270:Skyrim.esm') else b'\1\0')]
            if owner:
                pairs += [(b'XOWN', struct.pack('<I', fid(owner)))]
            body = record(b'CELL', fid(cell), pairs) + group(struct.pack('<I', fid(cell)), 6,
                    group(struct.pack('<I', fid(cell)), 8, b''.join(refs)))
            if cell in ('d74:Skyrim.esm', '1a270:Skyrim.esm'):
                world = 0x3c if cell == 'd74:Skyrim.esm' else 0x1a26f
                exterior.setdefault(world, []).append(body)
            else:
                interior.append(group(struct.pack('<i', 0), 2, group(struct.pack('<i', 0), 3, body)))
        groups = []
        base_ids = [0x2834e, 0x5ad3c, 0x252c7, 0xe9e08, 0xe9e07] if name == 'Skyrim.esm' else [0xe9e07] if name == 'HearthFires.esm' else []
        if base_ids:
            groups.append(group(b'DOOR', 0, b''.join(record(b'DOOR', value,
                [(b'EDID', b'FixtureBase\0'), (b'FNAM', b'\0')]) for value in base_ids)))
        if interior:
            groups.append(group(b'CELL', 0, b''.join(interior)))
        if exterior:
            groups.append(group(b'WRLD', 0, b''.join(record(b'WRLD', world, [(b'EDID', b'FixtureWorld\0')]) +
                group(struct.pack('<I', world), 1, b''.join(rows)) for world, rows in exterior.items())))
        return plugin(groups, [] if name == 'Skyrim.esm' else ['Skyrim.esm'])
    plugins = [L.read_plugin(make(name), name, i) for i, name in enumerate(names)]
    win = L.winners(plugins, WANT)
    needed = set(PLAN) | {row[1] for row in PLAN.values()} | {row[0] for row in PLAN.values()} | {row[2] for row in PLAN.values()}
    guards = {}
    for desc in needed:
        entry = next(e for (tag, gid), e in win.items() if gid == key(desc))
        source = plugins[entry.pi]
        guards[desc] = {'type': entry.tag.decode(), 'winner': source.name,
                       'sourceSha256': hashlib.sha256(source.buf).hexdigest(),
                       'dataSha256': hashlib.sha256(source.data(entry)).hexdigest(), 'flags': entry.flags}
    return plugins, win, {'claimableDoorsUnlocked': {'doors': list(PLAN), 'records': guards}}


class TableTests(unittest.TestCase):
    def test_real_table_opens_exactly_four_and_preserves_staff_lock(self):
        plugins, _, policy = fixture()
        with tempfile.TemporaryDirectory(prefix='tw-four-doors-') as tmp:
            path = pathlib.Path(tmp)
            data = path / 'Data'
            data.mkdir()
            for source in plugins:
                (data / source.name).write_bytes(source.buf)
            (path / 'plugins.txt').write_text('*JKs Skyrim.esp\n')
            (path / 'policy.json').write_text(json.dumps(policy))
            args = [sys.executable, str(ROOT / 'scripts/dev/Build-DoorTable.py'), '--data', str(data),
                    '--plugins', str(path / 'plugins.txt'), '--policy', str(path / 'policy.json'),
                    '--out', str(path / 'doors.json'), '--tables', str(path / 'tables')]
            run = subprocess.run(args, capture_output=True, text=True, timeout=20)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            rows = json.loads((path / 'doors.json').read_text())['doors']
            for ref, expected in PLAN.items():
                self.assertNotIn('lock', rows[ref])
                self.assertEqual(rows[ref]['to'], expected[1])
            self.assertEqual(rows['40fa0:Skyrim.esm']['lock']['level'], 255)
            before = (path / 'doors.json').read_bytes()
            (path / 'plugins.txt').write_text('*JKs Skyrim.esp\n*Thornswood-Last.esp\n')
            run = subprocess.run(args, capture_output=True, text=True, timeout=20)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            self.assertEqual(before, (path / 'doors.json').read_bytes())


class RecordTests(unittest.TestCase):
    def select(self, plugins, win, policy):
        return L.claimable_doors.entries(plugins, win, policy, L.subrecords, L.vmad_parse)

    def test_real_policy_has_only_the_reviewed_refs_and_thirteen_guards(self):
        policy = json.loads((ROOT / 'game/data/last-plugin-policy.json').read_text())
        self.assertEqual(L.claimable_doors.policy_refs(policy), tuple(PLAN))
        self.assertEqual(len(policy['claimableDoorsUnlocked']['records']), 13)
        for bad in ('40fa0:Skyrim.esm', '100:Thornswood-Content.esp'):
            changed = copy.deepcopy(policy)
            changed['claimableDoorsUnlocked']['doors'][0] = bad
            with self.assertRaises(SystemExit):
                L.claimable_doors.policy_refs(changed)

    def test_all_four_exact_source_records_are_selected(self):
        plugins, win, policy = fixture()
        chosen = self.select(plugins, win, policy)
        self.assertEqual([plugins[e.pi].gid(e.fid) for e in chosen], [key(ref) for ref in PLAN])

    def test_changed_source_and_changed_record_refuse(self):
        plugins, win, policy = fixture()
        plugins[0].buf += b'changed'
        with self.assertRaisesRegex(SystemExit, 'changed source'):
            self.select(plugins, win, policy)
        plugins, win, policy = fixture()
        entry = win[(b'REFR', key('5a7ea:Skyrim.esm'))]
        source = plugins[entry.pi]
        changed = bytearray(source.buf)
        changed[entry.off + 24 + entry.size - 1] ^= 1
        source.buf = bytes(changed)
        # A collection-level hash update alone does not approve a changed door.
        for row in policy['claimableDoorsUnlocked']['records'].values():
            if row['winner'] == source.name:
                row['sourceSha256'] = hashlib.sha256(source.buf).hexdigest()
        with self.assertRaisesRegex(SystemExit, 'changed record'):
            self.select(plugins, win, policy)

    def overlay(self, plugins, groups):
        extra = L.read_plugin(plugin(groups, ['Skyrim.esm', 'JKs Skyrim.esp']), 'ReviewOverlay.esp', len(plugins))
        sources = plugins + [extra]
        return sources, L.winners(sources, WANT)

    def test_unexpected_cell_owner_or_script_refuses(self):
        for field, body in ((b'XOWN', struct.pack('<I', 0x135e9)), (b'VMAD', bytes(8))):
            plugins, _, policy = fixture()
            cell = record(b'CELL', 0x529dd, [(b'DATA', b'\1\0'), (field, body)])
            sources, win = self.overlay(plugins, [group(b'CELL', 0, cell)])
            with self.subTest(field=field), self.assertRaisesRegex(SystemExit, 'changed owner, script or parent'):
                self.select(sources, win, policy)

    def test_new_direct_and_custom_quest_dependencies_refuse(self):
        tree = {'ver': 5, 'fmt': 2, 'scripts': [{'name': b'QuestProtection', 'status': 0,
                'props': [{'name': b'ProtectedCell', 'type': 1, 'status': 1,
                           'value': {'fid': 0x529dd, 'alias': -1, 'unused': 0}}]}],
                'quest': {'unk': 2, 'frags': [], 'file': b'', 'aliases': []}, 'rest': b''}
        for field, body in ((b'ALFR', struct.pack('<I', 0x5a7ea)), (b'VMAD', L.vmad_write(tree))):
            plugins, _, policy = fixture()
            sources, win = self.overlay(plugins, [group(b'QUST', 0, record(b'QUST', 0x2000100, [(field, body)]))])
            with self.subTest(field=field), self.assertRaises(SystemExit):
                self.select(sources, win, policy)
        for field, body in ((b'XESP', struct.pack('<II', 0x5a7ea, 0)),
                            (b'XLKR', struct.pack('<II', 0, 0x5a7ea))):
            plugins, _, policy = fixture()
            cell = record(b'CELL', 0x529dd, [(b'DATA', b'\1\0')])
            cell += group(struct.pack('<I', 0x529dd), 6, group(struct.pack('<I', 0x529dd), 8,
                record(b'REFR', 0x2000100, [(b'NAME', struct.pack('<I', 0x2834e)), (field, body), (b'DATA', bytes(24))])))
            sources, win = self.overlay(plugins, [group(b'CELL', 0, cell)])
            with self.subTest(field=field), self.assertRaises(SystemExit):
                self.select(sources, win, policy)

    def test_actual_writer_recipe_and_final_verifier_preserve_every_other_field(self):
        plugins, source_win, policy = fixture()
        chosen = self.select(plugins, source_win, policy)
        names = [source.name for source in plugins]
        numbers = L.Renumber()
        numbers.masters = [name.lower() for name in names]
        made = {'achr': [], 'refr': [], 'cell': {}, 'wrld': {}, 'qust': [], 'lctn': [], 'cobj': [], 'alch': []}
        for entry in chosen:
            src = plugins[entry.pi]
            pairs = L.claimable_doors.copy_pairs(src, L.subrecords(src.data(entry)), numbers)
            made['refr'].append((numbers.one(src, entry.fid, 'fixture'), entry.flags, L.pack_subrecords(pairs), entry))
        for (tag, gid), entry in source_win.items():
            if tag not in (b'CELL', b'WRLD'):
                continue
            src = plugins[entry.pi]
            pairs = L.copy_record(src, entry, numbers, lambda *args: self.fail('no localized fixture strings'), 'fixture')
            made['cell' if tag == b'CELL' else 'wrld'][gid] = (
                numbers.one(src, entry.fid, 'fixture'), entry.flags, L.pack_subrecords(pairs), entry)
        final_bytes = L.write_plugin(made, names, plugins, numbers)
        final = L.read_plugin(final_bytes, 'Thornswood-Last.esp', len(plugins))
        recipe, _ = L.make_recipe(final_bytes, made, plugins)
        by_name = {src.name: src.buf for src in plugins}
        self.assertEqual(L.last_recipe.apply(recipe, by_name.get, lambda name: None), final_bytes)
        all_sources = plugins + [final]
        final_win = L.winners(all_sources, WANT)
        manifest = {'claimableDoorsUnlocked': list(PLAN)}
        def verify(rows=final_win, receipt=manifest):
            return L.claimable_doors.verify(all_sources, source_win, rows, final, receipt, policy,
                                           L.subrecords, L.vmad_parse, numbers)
        self.assertEqual(verify(), [])
        for entry in chosen:
            src = plugins[entry.pi]
            actual = final_win[(b'REFR', src.gid(entry.fid))]
            before = L.subrecords(src.data(entry))
            after = L.subrecords(final.data(actual))
            self.assertEqual([tag for tag, _ in after], [tag for tag, _ in before if tag != b'XLOC'])
            self.assertEqual(actual.flags, entry.flags)
            self.assertEqual(final.gid(actual.ctx[0]) if actual.ctx[0] else None,
                             src.gid(entry.ctx[0]) if entry.ctx[0] else None)
            for tag, body in before:
                if tag == b'XLOC':
                    continue
                copied = dict(after)[tag]
                if tag in (b'NAME', b'XTEL', b'XNDP'):
                    self.assertEqual(final.gid(struct.unpack_from('<I', copied)[0]) if struct.unpack_from('<I', copied)[0] else None,
                                     src.gid(struct.unpack_from('<I', body)[0]) if struct.unpack_from('<I', body)[0] else None)
                    self.assertEqual(copied[4:], body[4:])
                else:
                    self.assertEqual(copied, body)
            missing = dict(final_win)
            del missing[(b'REFR', src.gid(entry.fid))]
            self.assertTrue(verify(missing))
        self.assertTrue(verify(receipt={'claimableDoorsUnlocked': []}))
        for desc, owner in OWNERS.items():
            entry = final_win[(b'CELL', key(desc))]
            actual_owners = [final.gid(struct.unpack('<I', body)[0]) for tag, body in L.subrecords(final.data(entry)) if tag == b'XOWN']
            self.assertEqual(actual_owners, [key(owner)] if owner else [])
        # Changing an unrelated base/paired exit in Last is rejected too.
        altered = dict(final_win)
        pair_key = (b'REFR', key('52a40:Skyrim.esm'))
        altered[pair_key] = final_win[(b'REFR', key('5a7ea:Skyrim.esm'))]
        self.assertTrue(verify(altered))


if __name__ == '__main__':
    unittest.main(verbosity=2)
