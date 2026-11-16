"""The fine dishes' names come from the load order, not from a built table (#6351).

    node tests/test-6351-dish-names.js     (runs this, python tests/dish-names-cases.py)

scripts/mods/Add-ContentRecords.py names each fine dish "Fine " and its plain
dish's name. Until #6351 it read that name from game/data/recipes.json, a
table the chain writes after the plugin, out of a load order the plugin is
part of. Since #5191 no built table is committed, so the box's clean checkout
had none and every content build after 67c120a stopped on the plugin. Now
the name is the FULL of the dish's winning record in the load order, as
scripts/dev/Build-RecipeTable.ps1 names a recipe's output. The plugins here
are written byte by byte, so nothing needs the game.
"""
import contextlib
import importlib.util
import io
import os
import pathlib
import re
import struct
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOL = ROOT / 'scripts' / 'mods' / 'Add-ContentRecords.py'
SPEC = importlib.util.spec_from_file_location('add_content_records', TOOL)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)

LOCALISED = 0x80


def sub(tag, data):
    return tag + struct.pack('<H', len(data)) + data


def z(text):
    return text.encode('cp1252') + b'\x00'


def rec(tag, fid, subs, flags=0):
    body = b''.join(subs)
    return struct.pack('<4sIIIIHH', tag, len(body), flags, fid, 0, 44, 0) + body


def grup(label, gtype, body):
    if isinstance(label, int):
        label = struct.pack('<I', label)
    return struct.pack('<4sI4siHHI', b'GRUP', 24 + len(body), label, gtype, 0, 0, 0) + body


def plugin(masters, groups, flags=0):
    head = [sub(b'HEDR', struct.pack('<fiI', 1.71, 0, 0x1000))]
    for m in masters:
        head += [sub(b'MAST', z(m)), sub(b'DATA', struct.pack('<Q', 0))]
    return rec(b'TES4', 0, head, flags) + b''.join(groups)


def strings_file(table):
    directory, data = b'', b''
    for sid, text in table.items():
        directory += struct.pack('<II', sid, len(data))
        data += z(text)
    return struct.pack('<II', len(table), len(data)) + directory + data


def alch(fid, edid, full):
    return rec(b'ALCH', fid, [sub(b'EDID', z(edid)), sub(b'FULL', full)])


BEEF = '721e8:Skyrim.esm'
FONDUE = '810:Gourmet.esp'
STEW = 'f4314:Skyrim.esm'


class DishNames(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = self.tmp.name
        os.makedirs(os.path.join(self.data, 'Strings'))
        # Skyrim.esm is localised: its FULLs are string ids. A record in
        # another group, under the same id, is not a dish.
        skyrim = plugin([], [
            grup(b'MISC', 0, rec(b'MISC', 0x000F4314, [sub(b'EDID', z('NotADish')), sub(b'FULL', z('Not a dish'))])),
            grup(b'ALCH', 0, alch(0x000721E8, 'FoodBeefCooked', struct.pack('<I', 5)) +
                 alch(0x000F4314, 'FoodBeefStew', struct.pack('<I', 6))),
        ], LOCALISED)
        self.put('Skyrim.esm', skyrim)
        with open(os.path.join(self.data, 'Strings', 'skyrim_english.strings'), 'wb') as fh:
            fh.write(strings_file({5: 'Cooked Beef', 6: 'Beef Stew'}))
        for m in M.PLUGIN_MASTERS[1:]:
            self.put(m, plugin(['Skyrim.esm'], []))
        # Gourmet.esp is not localised, makes a dish of its own and renames
        # Skyrim's beef, as a later plugin in the order may.
        self.put('Gourmet.esp', plugin(['Skyrim.esm'], [
            grup(b'ALCH', 0, alch(0x000721E8, 'FoodBeefCooked', z('Seared Beef')) +
                 alch(0x01000810, 'MAG_FoodFondueMammoth', z('Mammoth Cheese Fondue'))),
        ]))
        # This plugin, in the order and on disk, renaming the stew: it is the
        # one being made, so it is never read for a name.
        self.put(M.PLUGIN, plugin(['Skyrim.esm'], [
            grup(b'ALCH', 0, alch(0x000F4314, 'FoodBeefStew', z('Wrong Stew'))),
        ]))

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, name, data):
        with open(os.path.join(self.data, name), 'wb') as fh:
            fh.write(data)

    def order(self, *lines):
        p = os.path.join(self.data, 'plugins.txt')
        with open(p, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(lines) + '\n')
        return p

    def stop(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as caught:
            M.dish_names(*args)
        return str(caught.exception.code)

    def test_winning_record_names_the_dish(self):
        names = M.dish_names(self.data, self.order('*Gourmet.esp', '*' + M.PLUGIN, 'Off.esp'),
                             [BEEF, FONDUE, STEW])
        self.assertEqual(names, {BEEF: 'Seared Beef', FONDUE: 'Mammoth Cheese Fondue', STEW: 'Beef Stew'})

    def test_localised_name_from_string_table(self):
        names = M.dish_names(self.data, self.order('Gourmet.esp'), [BEEF, STEW])
        self.assertEqual(names, {BEEF: 'Cooked Beef', STEW: 'Beef Stew'})

    def test_dish_no_plugin_has_stops(self):
        said = self.stop(self.data, self.order('Gourmet.esp'), [FONDUE])
        self.assertTrue(said.startswith('STOP. no plugin of the load order in ') and FONDUE in said, said)

    def test_missing_plugin_stops(self):
        said = self.stop(self.data, self.order('*Gourmet.esp', '*Gone.esp'), [BEEF])
        self.assertTrue(said.startswith('STOP. Gone.esp of the load order in ') and 'is not in' in said, said)

    def test_no_plugin_list_stops(self):
        said = self.stop(self.data, os.path.join(self.data, 'none.txt'), [BEEF])
        self.assertTrue(said.startswith('STOP. there is no plugin list at ') and '--plugins' in said, said)

    def test_names_make_the_records_as_before(self):
        # The editor id and name are made from the plain dish's name as they
        # were from recipes.json's: an apostrophe dropped, words joined.
        fine = M.quality_table()['fine']
        plain = [d for d in fine if not d.endswith(':' + M.PLUGIN)]
        wanted = M.quality_wanted(list(M.PLUGIN_MASTERS), M.PLUGIN, {d: 'Rabbit Stew' for d in plain})
        by = dict((dish, (edid, name)) for _, edid, name, dish, _ in wanted)
        self.assertEqual(by[plain[0]], ('ThornswoodFoodFineRabbitStew', 'Fine Rabbit Stew'))
        harvest = [r for r in M.FEASTS if r[2] == 'ThornswoodFoodFeastHarvestsEnd'][0]
        self.assertEqual(by['%x:%s' % (harvest[0] & 0xFFFFFF, M.PLUGIN)],
                         ("ThornswoodFoodFineHarvestsEndRoast", "Fine Harvest's End Roast"))
        self.assertEqual(sorted(M.quality_fids(list(M.PLUGIN_MASTERS), M.PLUGIN)),
                         sorted(f for f, _, _, _, _ in wanted))


class ReadsNoBuiltTable(unittest.TestCase):
    def test_every_table_the_tool_reads_is_committed(self):
        # The plugin is the first thing the box builds, from a clean checkout
        # of the commit: every game/data file it opens has to be in git.
        text = TOOL.read_text(encoding='utf-8')
        named = sorted(set(re.findall(r"'game',\s*'data',\s*'([^']+)'", text)))
        self.assertTrue(named)
        tracked = subprocess.run(['git', 'ls-files', '--'] + ['game/data/' + n for n in named],
                                 cwd=str(ROOT), capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(sorted(tracked), ['game/data/' + n for n in named])
        self.assertNotIn('recipes.json', text.split('def quality_table')[1].split('def dish_look')[0])


if __name__ == '__main__':
    # One PASS or FAIL line per case, as every harness prints them.
    passed = failed = 0
    for cls in (DishNames, ReadsNoBuiltTable):
        for name in unittest.defaultTestLoader.getTestCaseNames(cls):
            result = unittest.TestResult()
            cls(name).run(result)
            bad = result.failures + result.errors
            what = name[len('test_'):].replace('_', ' ')
            if bad:
                failed += 1
                print('FAIL  ' + what)
                for _, trace in bad:
                    print(trace)
            else:
                passed += 1
                print('PASS  ' + what)
    print('')
    print('%d passed, %d failed' % (passed, failed))
    raise SystemExit(1 if failed else 0)
