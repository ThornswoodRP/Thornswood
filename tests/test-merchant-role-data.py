"""Inactive role data must follow record identities and public source policy."""
import copy
import importlib.util
import pathlib
import hashlib
import json
import struct
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('role_data', ROOT / 'scripts/dev/Build-MerchantRoleTables.py')
roles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(roles)


def fixture():
    def desc(n):
        return '%x:Skyrim.esm' % n
    records = {desc(n): {'type': 'MISC', 'flags': 0, 'edid': '', 'winner': 'Skyrim.esm'} for n in range(16, 100)}
    recipes = {'recipes': {}, 'refused': {}, 'unowned': {}}
    for index, role in enumerate(roles.ROLES):
        recipes['recipes'][desc(80 + index)] = {
            'owner': role, 'out': desc(16 + index), 'type': 'MISC', 'name': role + ' good',
            'fires': True, 'inputItems': [{'item': desc(26 + index), 'type': 'MISC'}]}
    records[desc(16)]['type'] = 'ARMO'
    recipes['recipes'][desc(80)]['type'] = 'ARMO'
    for n in (40, 41, 42, 43, 44):
        records[desc(n)]['type'] = 'INGR'
    records[desc(45)].update(type='ALCH', food=True)
    records[desc(46)].update(type='SLGM', edid='SoulGemPetty')
    records[desc(47)].update(type='SLGM', edid='DA01SoulGemAzurasStar')
    harvests = {'harvests': {'plant': {'produce': desc(40)}}, 'crops': {'crop': {'produce': desc(45)}},
                'fish': {}, 'game': {}, 'unranked': {'unavailable': {'produce': desc(48)}}}
    hunts = {'hunts': {'animal': {'gives': [{'item': desc(41)}, {'item': desc(49)}]}}}
    items = {'saltPile': desc(42), 'chickenEgg': desc(43), 'honeycomb': desc(44)}
    cuts = {'items': [], 'rieklingKept': ['Riekling Fur Armour']}
    return recipes, harvests, hunts, items, cuts, records


class RoleDataTests(unittest.TestCase):
    def test_only_the_cut_source_path_may_change(self):
        old = 'docs/systems/cut-items.json'
        new = 'game/data/cut-items.json'
        expected = {new: '1' * 64, 'game/data/hunts.json': '2' * 64}
        stored = {old: '1' * 64, 'game/data/hunts.json': '2' * 64}
        self.assertTrue(roles.source_hashes_match(stored, expected))
        self.assertTrue(roles.source_hashes_match(expected, expected))
        self.assertFalse(roles.source_hashes_match({**stored, old: '3' * 64}, expected))
        self.assertFalse(roles.source_hashes_match({**stored, new: expected[new]}, expected))
        self.assertFalse(roles.source_hashes_match({**stored, 'game/data/hunts.json': '4' * 64}, expected))

    def test_roles_and_measured_nonplant_sources(self):
        tables, evidence = roles.derive(*fixture())
        self.assertEqual(tuple(tables), roles.ROLES)
        self.assertEqual(len({tuple(t['buy']) for t in tables.values()}), 6)
        self.assertTrue({'28:Skyrim.esm', '29:Skyrim.esm', '2a:Skyrim.esm', '2b:Skyrim.esm', '2c:Skyrim.esm'} <= set(tables['Alchemist']['buy']))
        self.assertNotIn('30:Skyrim.esm', tables['Alchemist']['buy'])
        self.assertNotIn('31:Skyrim.esm', tables['Alchemist']['buy'])
        self.assertIn('2d:Skyrim.esm', tables['Cook']['buy'])
        self.assertIn('2e:Skyrim.esm', tables['Enchanter']['buy'])
        self.assertNotIn('2f:Skyrim.esm', tables['Enchanter']['buy'])
        self.assertIn('10:Skyrim.esm', tables['Enchanter']['buy'])
        self.assertTrue(evidence['29:Skyrim.esm'])
        for table in tables.values():
            self.assertTrue(set(table['supply']) <= set(table['buy']))

    def test_public_equipment_and_playable_riekling_exception(self):
        f = fixture()
        row = f[0]['recipes']['50:Skyrim.esm']
        row.update(race='riekling', name='Riekling Fur Armour')
        self.assertIn(row['out'], roles.derive(*f)[0]['Smith']['sell'])
        row['name'] = 'Unapproved creature suit'
        with self.assertRaisesRegex(ValueError, 'Riekling'):
            roles.derive(*f)
        row['race'] = ''
        f[5][row['out']]['flags'] = 4
        with self.assertRaisesRegex(ValueError, 'nonplayable'):
            roles.derive(*f)

    def test_deleted_missing_wrong_type_and_currency_refuse(self):
        for change in ('deleted', 'missing', 'type', 'gold'):
            f = fixture()
            row = f[0]['recipes']['50:Skyrim.esm']
            if change == 'deleted':
                f[5][row['out']]['flags'] = 32
            elif change == 'missing':
                del f[5][row['out']]
            elif change == 'type':
                f[5][row['out']]['type'] = 'WEAP'
            else:
                row['out'] = 'f:Skyrim.esm'
            with self.subTest(change=change), self.assertRaises(ValueError):
                roles.derive(*f)

    def test_cut_recipe_join_preserves_canonical_duplicate_only(self):
        f = fixture()
        original = f[0]['recipes']['50:Skyrim.esm']
        f[0]['refused']['60:Skyrim.esm'] = {'out': original['out']}
        f[4]['items'] = [{'id': '60:Skyrim.esm', 'disposition': 'cut'}]
        self.assertIn(original['out'], roles.derive(*f)[0]['Smith']['buy'])
        f[0]['refused']['60:Skyrim.esm']['out'] = '1a:Skyrim.esm'
        with self.assertRaisesRegex(ValueError, 'excluded'):
            roles.derive(*f)

    def test_faction_roll_is_not_public_and_input_is_unchanged(self):
        f = fixture()
        f[0]['recipes']['61:Skyrim.esm'] = dict(f[0]['recipes']['50:Skyrim.esm'], out='3f:Skyrim.esm', roll='embassy')
        before = copy.deepcopy(f)
        tables, _ = roles.derive(*f)
        self.assertNotIn('3f:Skyrim.esm', tables['Smith']['buy'])
        self.assertEqual(f, before)

    def test_kept_unowned_smelt_is_a_canonical_source_but_tempering_is_not(self):
        f = fixture()
        f[0]['refused']['60:Skyrim.esm'] = {'out': '1a:Skyrim.esm'}
        f[4]['items'] = [{'id': '60:Skyrim.esm', 'disposition': 'cut'}]
        f[0]['unowned']['61:Skyrim.esm'] = {'out': '1a:Skyrim.esm', 'benchName': 'CraftingSmelter'}
        self.assertIn('1a:Skyrim.esm', roles.derive(*f)[0]['Smith']['buy'])
        f[0]['unowned']['61:Skyrim.esm']['benchName'] = 'CraftingSmithingSharpeningWheel'
        with self.assertRaisesRegex(ValueError, 'excluded'):
            roles.derive(*f)

    def test_a_recipe_gold_fee_does_not_become_a_trade_item(self):
        f = fixture()
        f[0]['recipes']['50:Skyrim.esm']['inputItems'].append({'item': 'f:Skyrim.esm', 'type': 'MISC'})
        tables, _ = roles.derive(*f)
        self.assertTrue(all('f:Skyrim.esm' not in ids for table in tables.values() for ids in table.values()))

    def test_currency_and_padded_or_runtime_identities_cannot_alias_goods(self):
        for item in ('00000f:Skyrim.esm', 'ff000001:Skyrim.esm', '010:Skyrim.esm'):
            with self.subTest(item=item), self.assertRaises(ValueError):
                roles.record_of({item: {'type': 'MISC', 'flags': 0}}, item)

    def test_direct_item_cut_and_explicitly_cut_public_producer_refuse(self):
        for reference in ('10:Skyrim.esm', '50:Skyrim.esm'):
            f = fixture()
            f[4]['items'] = [{'id': reference, 'disposition': 'cut'}]
            with self.subTest(reference=reference), self.assertRaises(ValueError):
                roles.derive(*f)

    def test_truncated_native_record_and_group_envelopes_refuse(self):
        module = roles.reader()
        header = struct.pack('<4sIIIIHH', b'TES4', 0, 0, 0, 0, 44, 0)
        body = b'EDID' + struct.pack('<H', 8) + b'Fixture\0'
        record = struct.pack('<4sIIIIHH', b'MISC', len(body) + 100, 0, 0x800, 0, 44, 0) + body
        cases = (header + record,
                 header + struct.pack('<4sI4siHHHH', b'GRUP', 23, b'MISC', 0, 0, 0, 0, 0),
                 header + struct.pack('<4sI4siHHHH', b'GRUP', len(record) + 25, b'MISC', 0, 0, 0, 0, 0) + record)
        scratch = ROOT.resolve()
        with tempfile.TemporaryDirectory(prefix='role-data-envelope-', dir=scratch) as folder:
            path = pathlib.Path(folder).resolve() / 'Fixture.esp'
            self.assertEqual(path.parent.parent, scratch)
            for data in cases:
                path.write_bytes(data)
                with self.subTest(size=len(data)), self.assertRaises(ValueError):
                    roles.plugin_records(module, path, 'Fixture.esp', 0, [{'name': 'Fixture.esp'}])

    def test_native_source_override_and_deleted_record_evidence(self):
        module = roles.reader()
        def sub(tag, body):
            return tag + struct.pack('<H', len(body)) + body
        def record(tag, body, fid=0, flags=0):
            return struct.pack('<4sIIIIHH', tag, len(body), flags, fid, 0, 44, 0) + body
        def plugin(flags=0, food_flags=2, extra=b'', tag=b'ALCH'):
            header = record(b'TES4', sub(b'MAST', b'Skyrim.esm\0') + sub(b'DATA', bytes(8)))
            body = sub(b'EDID', b'FixtureFood\0') + sub(b'ENIT', struct.pack('<III', 2, food_flags, 0)) + extra
            item = record(tag, body, 0x1000, flags)
            # Native files can carry non-item navigation sentinels, not goods.
            return header + struct.pack('<4sI4siHHHH', b'GRUP', 24 + len(item), b'ALCH', 0, 0, 0, 0, 0) + item + record(b'NAVI', b'', 0xffffffff)
        scratch = ROOT.resolve()
        with tempfile.TemporaryDirectory(prefix='role-data-fixture-', dir=scratch) as folder:
            root = pathlib.Path(folder).resolve()
            self.assertEqual(root.parent, scratch)
            content = root / 'game/content'
            content.mkdir(parents=True)
            path = content / 'Fixture.esp'
            path.write_bytes(plugin())
            order = [{'name': 'Skyrim.esm', 'sha256': 'base'}, {'name': 'Fixture.esp', 'sha256': 'old'}]
            rows, source_sha = roles.plugin_records(module, path, 'Fixture.esp', 1, order)
            self.assertEqual(source_sha, hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertTrue(rows['1000:Skyrim.esm']['food'])
            self.assertEqual(rows['1000:Skyrim.esm']['winner'], 'Fixture.esp')
            (root / 'game/data').mkdir()
            (root / 'game/data/npc-population.json').write_text(json.dumps({'loadOrder': order}))
            payload = {'records': rows, 'loadOrder': [dict(order[0], repository=False), dict(order[1], repository=True)]}
            with mock.patch.object(roles, 'ROOT', root), mock.patch.object(roles, 'reader', return_value=module):
                roles.validate_provenance(payload)
                path.write_bytes(plugin(extra=sub(b'FULL', b'Changed display name\0')))
                roles.validate_provenance(payload)
                path.write_bytes(plugin(food_flags=0))
                with self.assertRaisesRegex(ValueError, 'source pin changed'):
                    roles.plugin_records(module, path, 'Fixture.esp', 1, order, source_sha)
                with self.assertRaisesRegex(ValueError, 'evidence changed'):
                    roles.validate_provenance(payload)
                path.write_bytes(plugin(flags=32))
                with self.assertRaisesRegex(ValueError, 'evidence changed'):
                    roles.validate_provenance(payload)
                path.write_bytes(plugin(tag=b'STAT'))
                changed = roles.plugin_records(module, path, 'Fixture.esp', 1, order)[0]
                self.assertEqual(changed['1000:Skyrim.esm']['type'], 'STAT')
                with self.assertRaises(ValueError):
                    roles.record_of(changed, '1000:Skyrim.esm')
                with self.assertRaisesRegex(ValueError, 'evidence changed'):
                    roles.validate_provenance(payload)
                path.write_bytes(plugin())
                later = content / 'Later.esp'
                later.write_bytes(plugin(extra=sub(b'EDID', b'LaterFood\0')))
                order.append({'name': 'Later.esp', 'sha256': 'old'})
                (root / 'game/data/npc-population.json').write_text(json.dumps({'loadOrder': order}))
                payload['loadOrder'].append(dict(order[-1], repository=True))
                payload['records'] = roles.plugin_records(module, later, 'Later.esp', 2, order)[0]
                roles.validate_provenance(payload)
                later.write_bytes(record(b'TES4', sub(b'MAST', b'Skyrim.esm\0') + sub(b'DATA', bytes(8))))
                with self.assertRaisesRegex(ValueError, 'disappeared|evidence changed'):
                    roles.validate_provenance(payload)

    def test_generation_retains_nonselected_direct_cut_evidence(self):
        f = fixture()
        f[4]['items'] = [{'id': '3f:Skyrim.esm', 'disposition': 'cut'}]
        order = [{'name': 'Skyrim.esm', 'sha256': 'source'}]
        with mock.patch.object(roles, 'reader', return_value=None), \
                mock.patch.object(roles, 'source_order', return_value=order), \
                mock.patch.object(roles, 'plugin_records', return_value=(f[5], 'source')):
            payload = roles.generate(f[:5], ROOT, {})
        self.assertIn('3f:Skyrim.esm', payload['records'])
        self.assertTrue(all('3f:Skyrim.esm' not in ids for table in payload['tables'].values() for ids in table.values()))

    def test_committed_catalogue_is_inactive_and_exactly_derived(self):
        payload = roles.load(roles.OUT)
        self.assertIs(payload['active'], False)
        roles.validate_provenance(payload)
        tables, evidence = roles.derive(*[roles.load(ROOT / name) for name in roles.INPUTS], payload['records'])
        self.assertEqual(payload['tables'], tables)
        self.assertEqual(payload['evidence'], evidence)
        self.assertEqual(len({tuple(row['buy']) for row in tables.values()}), 6)
        self.assertIn('3ad6f:Skyrim.esm', tables['Alchemist']['buy'])
        self.assertIn('23d77:Skyrim.esm', tables['Alchemist']['buy'])
        self.assertIn('b08c5:Skyrim.esm', tables['Alchemist']['buy'])

    def test_check_refuses_changed_permissions_counts_sources_or_activation(self):
        original = roles.load(roles.OUT)
        scratch = ROOT.resolve()
        with tempfile.TemporaryDirectory(prefix='role-data-check-', dir=scratch) as folder:
            path = pathlib.Path(folder).resolve() / 'roles.json'
            self.assertEqual(path.parent.parent, scratch)
            changes = (
                lambda p: p.update(active=True),
                lambda p: p['tables']['Smith']['buy'].append('f:Skyrim.esm'),
                lambda p: p['counts']['Smith'].update(buy=0),
                lambda p: p['sources'].update({'game/data/recipes.json': 'stale'}),
                lambda p: p['loadOrder'][0].update(sha256='stale'),
                lambda p: p['evidence'].clear())
            for change in changes:
                payload = copy.deepcopy(original)
                change(payload)
                path.write_text(json.dumps(payload), encoding='utf-8')
                with self.subTest(change=change), mock.patch.object(roles, 'OUT', path), \
                        mock.patch('sys.argv', ['Build-MerchantRoleTables.py', '--check']), self.assertRaises(ValueError):
                    roles.main()

    def test_source_changes_during_generation_leave_no_output(self):
        scratch = ROOT.resolve()
        with tempfile.TemporaryDirectory(prefix='role-data-inputs-', dir=scratch) as folder:
            root = pathlib.Path(folder).resolve()
            self.assertEqual(root.parent, scratch)
            for name in roles.INPUTS:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('{}', encoding='utf-8')
            output = root / 'role-output.json'
            def changed(*args):
                (root / roles.INPUTS[0]).write_text('{"changed":true}', encoding='utf-8')
                return {'counts': {}}
            with mock.patch.object(roles, 'ROOT', root), mock.patch.object(roles, 'OUT', output), \
                    mock.patch.object(roles, 'generate', side_effect=changed), \
                    mock.patch.object(roles, 'validate_provenance', return_value=None), \
                    mock.patch('sys.argv', ['Build-MerchantRoleTables.py']):
                with self.assertRaisesRegex(ValueError, 'sources changed'):
                    roles.main()
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
