"""scripts/mods/Check-PluginClean.py against small plugins written here, without the game (#2790).

    python tests/test-2790-plugin-clean.py

Each case is a plugin built byte by byte with the one fault it is about, so a
check that stops finding it goes red. The last case runs the check the build
runs, --no-masters over game/content, and needs it clean.
"""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import struct
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('check_plugin_clean', ROOT / 'scripts' / 'mods' / 'Check-PluginClean.py')
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)
WSPEC = importlib.util.spec_from_file_location('add_content_records', ROOT / 'scripts' / 'mods' / 'Add-ContentRecords.py')
WRITER = importlib.util.module_from_spec(WSPEC)
WSPEC.loader.exec_module(WRITER)


def sub(tag, data):
    return tag + struct.pack('<H', len(data)) + data


def z(text):
    return text.encode('latin1') + b'\x00'


def rec(tag, fid, subs, flags=0):
    body = b''.join(subs)
    return struct.pack('<4sIIIIHH', tag, len(body), flags, fid, 0, 44, 0) + body


def grup(label, gtype, body):
    if isinstance(label, int):
        label = struct.pack('<I', label)
    return struct.pack('<4sI4siHHI', b'GRUP', 24 + len(body), label, gtype, 0, 0, 0) + body


def plugin(masters, groups, flags=0, next_object=0x1000):
    head = [sub(b'HEDR', struct.pack('<fiI', 1.71, 0, next_object))]
    for m in masters:
        head += [sub(b'MAST', z(m)), sub(b'DATA', struct.pack('<Q', 0))]
    return rec(b'TES4', 0, head, flags) + b''.join(groups)


def strings_file(table):
    directory, data = b'', b''
    for sid, text in table.items():
        directory += struct.pack('<II', sid, len(data))
        data += z(text)
    return struct.pack('<II', len(table), len(data)) + directory + data


def cell(fid, edid, children=b'', flags=0):
    out = rec(b'CELL', fid, [sub(b'EDID', z(edid)), sub(b'DATA', struct.pack('<H', 1))], flags)
    if children:
        out += grup(fid, 6, grup(fid, 9, children))
    return out


def refr(fid, base, flags=0):
    return rec(b'REFR', fid, [sub(b'NAME', struct.pack('<I', base)),
                              sub(b'DATA', b'\x00' * 24)], flags)


def misc(fid, edid, name):
    return rec(b'MISC', fid, [sub(b'EDID', z(edid)), sub(b'FULL', name),
                              sub(b'DATA', struct.pack('<If', 5, 1.0))])


def cobj(fid, edid, made, bench):
    return rec(b'COBJ', fid, [sub(b'EDID', z(edid)), sub(b'CNAM', struct.pack('<I', made)),
                              sub(b'BNAM', struct.pack('<I', bench)), sub(b'NAM1', struct.pack('<H', 1))])


def cells_group(*cells):
    # An interior cell block and sub-block, the way Skyrim nests them.
    return grup(b'CELL', 0, grup(0, 2, grup(0, 3, b''.join(cells))))


# The masters every case below loads against.
#   M.esm, localised: MISC 802 "Bucket" (string 5), MISC 803 "Rope" (6),
#     COBJ 801 making 802 at bench 804, a cell 900 holding REFR 901 of 802,
#     an empty cell 910.
#   O.esp, on M: MISC 0x01000800 of its own.
#   N.esp, on M: MISC 0x01000800 of its own, COBJ 0x01000801 making it.
def masters():
    m = plugin([], [
        grup(b'MISC', 0, misc(0x802, 'Bucket', struct.pack('<I', 5)) +
             misc(0x803, 'Rope', struct.pack('<I', 6)) +
             misc(0x804, 'Bench', struct.pack('<I', 7))),
        grup(b'COBJ', 0, cobj(0x801, 'RecipeBucket', 0x802, 0x804)),
        cells_group(cell(0x900, 'BucketRoom', refr(0x901, 0x802)), cell(0x910, 'EmptyRoom')),
    ], flags=0x81)
    o = plugin(['M.esm'], [grup(b'MISC', 0, misc(0x01000800, 'Other', z('Other')))])
    n = plugin(['M.esm'], [
        grup(b'MISC', 0, misc(0x01000800, 'Pail', z('Pail'))),
        grup(b'COBJ', 0, cobj(0x01000801, 'RecipePail', 0x01000800, 0x804)),
    ])
    return {'M.esm': m, 'O.esp': o, 'N.esp': n,
            'Strings/m_english.strings': strings_file({5: 'Bucket', 6: 'Rope', 7: 'Bench'})}


class PluginClean(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        for name, data in masters().items():
            self.put(name, data)
        order = ['M.esm', 'O.esp', 'N.esp', 'I.esp', 'P.esp']
        self.put('order.json', json.dumps({'loadOrder': [{'name': n} for n in order]}).encode())

    def put(self, name, data):
        path = os.path.join(self.dir, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as fh:
            fh.write(data)

    def run_check(self, name, data, *extra):
        self.put(name, data)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = CHECK.main(['--data', self.dir, '--catalogue', os.path.join(self.dir, 'order.json')] +
                              list(extra) + [name])
        return code, out.getvalue()

    def section(self, text, title):
        lines = text.splitlines()
        at = lines.index('  ' + title)
        got = []
        for l in lines[at + 1:]:
            if not l.startswith('    '):
                break
            got.append(l.strip())
        return [] if got == ['none'] else got

    def test_identical_records_are_found_and_changed_ones_are_not(self):
        p = plugin(['M.esm', 'O.esp', 'N.esp'], [
            grup(b'MISC', 0,
                 # The same text as the master's string 5, written plain: identical.
                 misc(0x802, 'Bucket', z('Bucket')) +
                 # Another name than the master's string 6: changed.
                 misc(0x803, 'Rope', z('Cord'))),
            grup(b'COBJ', 0,
                 cobj(0x801, 'RecipeBucket', 0x802, 0x804) +
                 # N's own MISC is 01 in N and 02 here: the same record, identical.
                 cobj(0x02000801, 'RecipePail', 0x02000800, 0x804)),
        ])
        code, text = self.run_check('P.esp', p)
        self.assertEqual(code, 1, text)
        itm = self.section(text, 'Identical to master, to clean')
        self.assertIn("MISC 00000802 is identical to M.esm's", itm)
        self.assertIn("COBJ 00000801 is identical to M.esm's", itm)
        self.assertIn("COBJ 02000801 is identical to N.esp's", itm)
        self.assertEqual(len(itm), 3, text)
        self.assertEqual(self.section(text, 'Errors'), [], text)

    def test_a_form_id_naming_another_file_is_a_change(self):
        # 01 here is O.esp, whose 800 is another record than N's 800.
        p = plugin(['M.esm', 'O.esp', 'N.esp'], [
            grup(b'COBJ', 0, cobj(0x02000801, 'RecipePail', 0x01000800, 0x804)),
        ])
        code, text = self.run_check('P.esp', p)
        self.assertEqual(code, 0, text)
        self.assertEqual(self.section(text, 'Identical to master, to clean'), [], text)

    def test_an_identical_cell_holding_records_is_kept_and_an_empty_one_is_not(self):
        p = plugin(['M.esm'], [
            grup(b'MISC', 0, misc(0x01000800, 'NewThing', z('New thing'))),
            cells_group(cell(0x900, 'BucketRoom', refr(0x01000801, 0x01000800)),
                        cell(0x910, 'EmptyRoom')),
        ], next_object=0x802)
        code, text = self.run_check('P.esp', p)
        self.assertEqual(code, 1, text)
        self.assertEqual(self.section(text, 'Identical to master, to clean'),
                         ["CELL 00000910 is identical to M.esm's"], text)
        self.assertEqual(self.section(text, 'Identical to master and kept, the parent of records'),
                         ["CELL 00000900, the parent of 1 of this plugin's records"], text)

    def test_text_with_no_string_table_is_not_called_identical(self):
        os.remove(os.path.join(self.dir, 'Strings', 'm_english.strings'))
        p = plugin(['M.esm'], [grup(b'MISC', 0, misc(0x802, 'Bucket', z('Bucket')))])
        code, text = self.run_check('P.esp', p)
        self.assertEqual(code, 2, text)
        self.assertEqual(self.section(text, 'Identical to master, to clean'), [], text)
        self.assertEqual(self.section(text, 'Could not tell, the string tables are missing'),
                         ["MISC 00000802 is M.esm's but for localised text whose string table is not "
                          "in the Data folder"], text)

    def test_a_deleted_reference_is_found_without_the_masters(self):
        p = plugin(['M.esm'], [cells_group(cell(0x900, 'BucketRoom', refr(0x901, 0x802, flags=0x20)))])
        code, text = self.run_check('P.esp', p, '--no-masters')
        self.assertEqual(code, 1, text)
        self.assertEqual(self.section(text, 'Deleted records'), ['deleted reference REFR 00000901'], text)

    def test_a_reference_to_nothing_is_an_error(self):
        p = plugin(['M.esm'], [cells_group(cell(0x900, 'BucketRoom', refr(0x01000800, 0xFFF)))],
                   next_object=0x801)
        code, text = self.run_check('P.esp', p)
        self.assertEqual(code, 1, text)
        self.assertIn('REFR 01000800 NAME names 00000FFF, which is in neither P.esp, its masters nor the load order',
                      self.section(text, 'Errors'), text)

    def test_a_record_another_plugin_injects_is_a_note(self):
        # I.esp, not a master of P, adds a keyword in M.esm's numbering, the
        # way MoreCraftableEquipment.esp adds its loom keyword to Update.esm.
        self.put('I.esp', plugin(['M.esm'], [grup(b'KYWD', 0, rec(b'KYWD', 0xABC, [sub(b'EDID', z('Loom'))]))]))
        p = plugin(['M.esm'], [grup(b'COBJ', 0, cobj(0x01000800, 'RecipeAtLoom', 0x802, 0xABC))],
                   next_object=0x801)
        code, text = self.run_check('P.esp', p)
        self.assertEqual(code, 0, text)
        self.assertEqual(self.section(text, 'Named through a plugin that is not a master'),
                         ["COBJ 01000800 BNAM names 00000ABC, which no master has; I.esp adds it as M.esm's"], text)

    def test_faults_in_the_file_itself(self):
        light = plugin(['M.esm'], [
            grup(b'MISC', 0, misc(0x01001000, 'TooHigh', z('x')) + misc(0x01000900, 'Twice', z('x')) +
                 misc(0x01000900, 'Twice', z('x')) + misc(0x05000900, 'NoSuchFile', z('x'))),
        ], flags=0x200, next_object=0x2000)
        code, text = self.run_check('L.esp', light, '--no-masters')
        self.assertEqual(code, 1, text)
        errors = self.section(text, 'Errors')
        self.assertIn('MISC 01001000 is added by a light plugin outside 0x800 to 0xFFF', errors)
        self.assertTrue(any(e.startswith('MISC 01000900 is in the file twice') for e in errors), errors)
        self.assertTrue(any(e.startswith('MISC 05000900 has file index 05') for e in errors), errors)

        late = plugin(['M.esm'], [grup(b'MISC', 0, misc(0x01000900, 'Late', z('x')))], next_object=0x900)
        code, text = self.run_check('H.esp', late, '--no-masters')
        self.assertIn("MISC 01000900 is at or past the header's next object id 000900",
                      self.section(text, 'Errors'), text)

        whole = plugin(['M.esm'], [grup(b'MISC', 0, misc(0x01000800, 'Cut', z('x')))])
        cut = whole[:-3] + b'\x00\x00\x00\x00\x00'
        code, text = self.run_check('C.esp', cut, '--no-masters')
        self.assertEqual(code, 1, text)
        self.assertTrue(self.section(text, 'Errors'), text)

    def test_masters_out_of_order_and_missing(self):
        p = plugin(['N.esp', 'M.esm'], [grup(b'MISC', 0, misc(0x02000800, 'New', z('x')))])
        code, text = self.run_check('Q.esp', p)
        self.assertEqual(code, 1, text)
        self.assertIn("N.esp needs M.esm, which comes after it in this plugin's masters",
                      self.section(text, 'Errors'), text)

        p = plugin(['M.esm', 'Gone.esp'], [grup(b'MISC', 0, misc(0x02000800, 'New', z('x')))])
        code, text = self.run_check('G.esp', p)
        self.assertEqual(code, 2, text)
        self.assertIn('COULD NOT CHECK against the masters', text)

    def test_a_clean_plugin_is_clean(self):
        p = plugin(['M.esm'], [
            grup(b'MISC', 0, misc(0x803, 'Rope', z('Cord')) + misc(0x01000800, 'New', z('New'))),
            cells_group(cell(0x900, 'BucketRoom', refr(0x01000801, 0x01000800))),
        ], next_object=0x802)
        code, text = self.run_check('P.esp', p)
        self.assertEqual(code, 0, text)
        self.assertIn('1 clean, 0 not clean', text)

    def test_the_content_writer_holds_a_cell_only_with_what_it_places(self):
        # The plugin is written from nothing (#5191), so a cell is in it only
        # because a placement is put in it: its record, then its children
        # group holding the placement, in the block and sub-block it belongs
        # to. No group is left without the record it belongs to (#2790).
        stamp = b'\x00' * 4
        def rec(tag, fid):
            return WRITER.Rec(tag, 0, fid, b'\x00' * 8, b'')
        tree = [WRITER.Grup(b'CELL' + b'\x00' * 8 + stamp, [])]
        ctx = ((2, struct.pack('<i', 5)), (3, struct.pack('<i', 5)), False)
        WRITER.put_cell(tree, rec(b'CELL', 0x8EB5), ctx, None, stamp)
        WRITER.put_placement(tree, rec(b'REFR', 0x05015506), 0x8EB5, stamp)
        self.assertEqual(WRITER.orphan_groups(tree), [])
        cells = [k for k in WRITER.every_record(tree) if k.tag == b'CELL']
        self.assertEqual([k.fid for k in cells], [0x8EB5])
        kids, i = WRITER.find_cell(tree, 0x8EB5)
        children = kids[i + 1]
        self.assertEqual((WRITER.group_type(children), WRITER.group_id(children)), (6, 0x8EB5))
        temp = children.kids[0]
        self.assertEqual(WRITER.group_type(temp), 9)
        self.assertEqual([k.fid for k in temp.kids], [0x05015506])

    def test_the_plugins_in_game_content_pass_the_build_check(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = CHECK.main(['--no-masters'])
        self.assertEqual(code, 0, out.getvalue())


if __name__ == '__main__':
    unittest.main()
