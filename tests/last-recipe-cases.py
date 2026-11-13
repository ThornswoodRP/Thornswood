"""scripts/mods/last_recipe.py against small plugins written here, without the game (#2791).

    python tests/last-recipe-cases.py

game/tests/test-2791-last-recipe.js runs it on the build check.

Thornswood-Last.esp goes out as a recipe that each machine builds the plugin
from, out of its own plugins, so none of the records it copies are handed on
by Thornswood (Patrick's A of 26 Oct 2026). Each case here is a source plugin
and a built plugin made byte by byte the ways Build-LastPlugin.py changes a
copy (a renumbered form id, a subrecord left out, a localised name written
out, a field set, a condition added, a compressed source record), and holds:

  the recipe makes the built plugin back byte for byte, and nothing it writes
  as our own is a run of the source's bytes;
  a copy written as our own stops the recipe;
  a source that is not the bytes the recipe names, or is missing, makes
  nothing;
  and the committed recipe names the size and sha256 of the plugin
  game/data/last-plugin.json names (no repository holds the plugin since
  #2791 step 3), and reads to its end.
"""
import hashlib
import importlib.util
import json
import pathlib
import struct
import sys
import unittest
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('last_recipe', ROOT / 'scripts' / 'mods' / 'last_recipe.py')
R = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R)

NEVER_TRUE = struct.pack('<B3sfHHIIIIi', 4 << 5, b'\x00\x00\x00', 0.0, 47, 0, 0x0000000F, 0, 0, 0, -1)


def sub(tag, data):
    if len(data) > 0xFFFF:
        return b'XXXX' + struct.pack('<HI', 4, len(data)) + tag + struct.pack('<H', 0) + data
    return tag + struct.pack('<H', len(data)) + data


def rec(tag, flags, fid, data):
    return tag + struct.pack('<IIIIHH', len(data), flags, fid, 0, 44, 0) + data


def grup(label, body):
    return b'GRUP' + struct.pack('<I', 24 + len(body)) + label + struct.pack('<iHHI', 0, 0, 0, 0) + body


def header(masters, flags=0):
    h = sub(b'HEDR', struct.pack('<fiI', 1.71, 1, 0x800))
    for m in masters:
        h += sub(b'MAST', m.encode() + b'\x00') + sub(b'DATA', struct.pack('<Q', 0))
    return rec(b'TES4', flags, 0, h)


class Entry(object):
    def __init__(self, tag, fid, off, pi):
        self.tag, self.fid, self.off, self.pi = tag, fid, off, pi


class Source(object):
    def __init__(self, name, buf):
        self.name, self.buf = name, buf


def strings_table(rows):
    """A .STRINGS table: {id: text}."""
    ids = sorted(rows)
    body, offs = b'', []
    for i in ids:
        offs.append(len(body))
        body += rows[i] + b'\x00'
    return struct.pack('<II', len(ids), len(body)) + b''.join(struct.pack('<II', i, o) for i, o in zip(ids, offs)) + body


# A source plugin of another author's: a placed item, a cell with a localised
# name, and a quest stored compressed.
NAME_FID = struct.pack('<I', 0x01000ABC)
REFR_SRC = (sub(b'EDID', b'TheirChair\x00') + sub(b'NAME', NAME_FID) + sub(b'XSCL', struct.pack('<f', 1.25)) +
            sub(b'DATA', struct.pack('<6f', 101.5, -2203.25, 77.0, 0.0, 0.0, 1.5707)))
CELL_SRC = (sub(b'EDID', b'TheirCellEditorId\x00') + sub(b'FULL', struct.pack('<I', 42)) +
            sub(b'DATA', b'\x01\x00') + sub(b'XCLW', struct.pack('<f', -9876.5)) +
            sub(b'XCLR', bytes(range(40, 64))))
QUST_CTDA = struct.pack('<B3sfHHIIIIi', 0, b'\x00\x00\x00', 3.0, 72, 0, 0x01000DEF, 7, 0, 0, -1)
VMAD_SRC = b'\x05\x00\x02\x00\x01\x00' + b'\x0bTheirScript' + b'\x00\x01\x00' + b'\x07Feature\x01' + struct.pack('<I', 0x01000AAA) + b'\xff\xff'
QUST_SRC = (sub(b'EDID', b'TheirQuestWithLongName\x00') + sub(b'VMAD', VMAD_SRC) +
            sub(b'DNAM', struct.pack('<HBBfI', 0x111, 50, 0, 0.0, 0)) + sub(b'CTDA', QUST_CTDA) +
            sub(b'NEXT', b'') + sub(b'INDX', struct.pack('<HBB', 10, 0, 0)) +
            sub(b'CNAM', ('the quest text of another author, ' * 4).encode() + b'\x00'))
QUST_Z = struct.pack('<I', len(QUST_SRC)) + zlib.compress(QUST_SRC)


def source_plugin():
    head = header(['Skyrim.esm'], flags=0x80)
    refr = rec(b'REFR', 0, 0x01001000, REFR_SRC)
    cell = rec(b'CELL', 0, 0x01002000, CELL_SRC)
    qust = rec(b'QUST', 0x00040000, 0x01003000, QUST_Z)
    buf = head + grup(b'CELL', cell + refr) + grup(b'QUST', qust)
    at = {}
    for tag, fid in ((b'REFR', 0x01001000), (b'CELL', 0x01002000), (b'QUST', 0x01003000)):
        p = len(head)
        while True:
            p = buf.index(tag, p)
            if struct.unpack_from('<I', buf, p + 12)[0] == fid:
                break
            p += 4
        at[tag] = p
    return buf, at


def built_plugin(src, at):
    """What Build-LastPlugin.py would make of the three: every form id in
    its own numbering (the mod is master 1 there too, Skyrim.esm 0, but the
    named master moves to index 2), the item switched off with its scale left
    out, the cell's name written out and a location set, the quest stopped
    with the condition that is never true put first and a script property
    added."""
    refr = sub(b'EDID', b'TheirChair\x00') + sub(b'NAME', struct.pack('<I', 0x02000ABC)) + \
        sub(b'DATA', struct.pack('<6f', 101.5, -2203.25, 77.0, 0.0, 0.0, 1.5707))
    cell = (sub(b'EDID', b'TheirCellEditorId\x00') + sub(b'FULL', b'Their Lovely Hall\x00') +
            sub(b'DATA', b'\x01\x00') + sub(b'XCLW', struct.pack('<f', -9876.5)) +
            sub(b'XCLR', bytes(range(40, 64))) + sub(b'XLCN', struct.pack('<I', 0x0001A26F)))
    vmad = VMAD_SRC[:-2] + b'\x05Added\x03' + struct.pack('<i', 0) + b'\xff\xff'
    vmad = vmad.replace(struct.pack('<I', 0x01000AAA), struct.pack('<I', 0x02000AAA))
    qust = (sub(b'EDID', b'TheirQuestWithLongName\x00') + sub(b'VMAD', vmad) +
            sub(b'DNAM', struct.pack('<HBBfI', 0x110, 50, 0, 0.0, 0)) + sub(b'CTDA', NEVER_TRUE) +
            sub(b'CTDA', QUST_CTDA.replace(struct.pack('<I', 0x01000DEF), struct.pack('<I', 0x02000DEF))) +
            sub(b'NEXT', b'') + sub(b'INDX', struct.pack('<HBB', 10, 0, 0)) +
            sub(b'CNAM', ('the quest text of another author, ' * 4).encode() + b'\x00'))
    made = [(b'REFR', 0x02001000, 0x800, refr, Entry(b'REFR', 0x01001000, at[b'REFR'], 0)),
            (b'CELL', 0x02002000, 0, cell, Entry(b'CELL', 0x01002000, at[b'CELL'], 0)),
            (b'QUST', 0x02003000, 0, qust, Entry(b'QUST', 0x01003000, at[b'QUST'], 0))]
    out = header(['Skyrim.esm', 'Other.esm', 'Theirs.esp'], flags=0x200)
    out += grup(b'CELL', rec(b'CELL', 0, 0x02002000, cell) + rec(b'REFR', 0x800, 0x02001000, refr))
    out += grup(b'QUST', rec(b'QUST', 0, 0x02003000, qust))
    index = {(t, f): (d, e) for t, f, _, d, e in made}
    return out, index


TABLE = strings_table({41: b'Not this one', 42: b'Their Lovely Hall', 43: b'Nor this'})


def windows(b, n=12):
    return {b[k:k + n] for k in range(len(b) - n + 1) if len(set(b[k:k + n])) >= 4}


class RecipeCases(unittest.TestCase):

    def setUp(self):
        self.src, self.at = source_plugin()
        self.plugins = [Source('Theirs.esp', self.src)]
        self.tables = {('Theirs.esp', 'strings'): ('theirs_english.strings', TABLE)}
        self.out, self.index = built_plugin(self.src, self.at)

    def read(self, name):
        return {'theirs.esp': self.src}.get(name.lower())

    def table(self, name):
        return {'theirs_english.strings': TABLE}.get(name.lower())

    def test_makes_it_back(self):
        recipe, stats = R.make(self.out, self.index, self.plugins, self.tables, 'test')
        self.assertEqual(R.apply(recipe, self.read, self.table), self.out)
        self.assertEqual(stats['records'], 3)
        self.assertEqual(stats['addedSubrecords'], {'CTDA': 1, 'XLCN': 1})
        size, sha, sources, _ = R.read_header(recipe)
        self.assertEqual((size, sha), (len(self.out), hashlib.sha256(self.out).digest()))
        self.assertEqual([(k, n) for k, n, _, _ in sources],
                         [(R.PLUGIN_SOURCE, 'Theirs.esp'), (R.TABLE_SOURCE, 'theirs_english.strings')])

    def test_hands_on_nothing_of_theirs(self):
        recipe, _ = R.make(self.out, self.index, self.plugins, self.tables, 'test')
        # Their records' data and their names; a plugin header and a
        # subrecord's tag are the format's, not anybody's.
        theirs = windows(REFR_SRC) | windows(CELL_SRC) | windows(QUST_SRC) | windows(TABLE)
        self.assertFalse(theirs & windows(recipe), 'a run of the source plugin is in the recipe')
        for text in (b'TheirQuestWithLongName', b'Their Lovely Hall', b'the quest text', b'TheirScript'):
            self.assertNotIn(text, recipe)

    def test_a_copy_written_as_ours_stops_it(self):
        # The build "adds" a subrecord that is really the source's quest text.
        d, e = self.index[(b'QUST', 0x02003000)]
        leaked = d + sub(b'NNAM', ('the quest text of another author, ' * 2).encode())
        out = self.out.replace(rec(b'QUST', 0, 0x02003000, d), rec(b'QUST', 0, 0x02003000, leaked))
        out = out[:out.rindex(b'GRUP')] + grup(b'QUST', rec(b'QUST', 0, 0x02003000, leaked))
        index = dict(self.index)
        index[(b'QUST', 0x02003000)] = (leaked, e)
        with self.assertRaises(R.RecipeError):
            R.make(out, index, self.plugins, self.tables, 'test')

    def test_another_copy_makes_nothing(self):
        recipe, _ = R.make(self.out, self.index, self.plugins, self.tables, 'test')
        other = bytearray(self.src)
        other[-1] ^= 1
        with self.assertRaises(R.RecipeError):
            R.apply(recipe, lambda n: bytes(other), self.table)
        with self.assertRaises(R.RecipeError):
            R.apply(recipe, lambda n: None, self.table)
        with self.assertRaises(R.RecipeError):
            R.apply(recipe, self.read, lambda n: None)

    def test_a_record_it_did_not_make_stops_it(self):
        index = dict(self.index)
        del index[(b'REFR', 0x02001000)]
        with self.assertRaises(R.RecipeError):
            R.make(self.out, index, self.plugins, self.tables, 'test')

    def test_long_subrecord(self):
        big = bytes((i * 7) % 251 for i in range(70000))
        src = header(['Skyrim.esm']) + grup(b'WRLD', rec(b'WRLD', 0, 0x01000100, sub(b'EDID', b'W\x00') + sub(b'OFST', big)))
        at = src.index(b'WRLD', src.index(b'GRUP') + 24)
        data = sub(b'EDID', b'W\x00') + sub(b'OFST', big[:1000] + b'\x09' + big[1001:])
        out = header(['Skyrim.esm', 'Big.esp']) + grup(b'WRLD', rec(b'WRLD', 0, 0x01000100, data))
        index = {(b'WRLD', 0x01000100): (data, Entry(b'WRLD', 0x01000100, at, 0))}
        recipe, _ = R.make(out, index, [Source('Big.esp', src)], {}, 'test')
        self.assertEqual(R.apply(recipe, lambda n: src, lambda n: None), out)
        self.assertLess(len(recipe), 1000)


class Committed(unittest.TestCase):
    """The committed recipe names the manifest's plugin, and reads to its end."""

    def test_names_the_plugin(self):
        path = ROOT / 'game' / 'data' / 'last-plugin.recipe'
        if not path.exists():
            self.skipTest('no committed recipe yet: the next build of Thornswood-Last.esp writes it')
        recipe = path.read_bytes()
        manifest = json.loads((ROOT / 'game' / 'data' / 'last-plugin.json').read_text(encoding='utf-8'))
        size, sha, sources, r = R.read_header(recipe)
        self.assertEqual((size, sha.hex()), (manifest['plugin']['size'], manifest['plugin']['sha256']))
        self.assertEqual(manifest['recipe']['sha256'], hashlib.sha256(recipe).hexdigest())
        built = {row['name'].lower(): row for row in manifest['builtAgainst']}
        for kind, name, n, want in sources:
            if kind == R.PLUGIN_SOURCE:
                self.assertIn(name.lower(), built, name + ' is not a plugin the manifest was built against')
                self.assertEqual((n, want.hex()), (built[name.lower()]['size'], built[name.lower()]['sha256']))
        made = 0
        while r.p < len(recipe):
            op = r.byte()
            if op == R.LIT:
                n = r.varint()
                r.raw(n)
                made += n
            elif op == R.REC:
                r.varint(), r.varint()
            elif op == R.CPY:
                r.varint()
                made += r.varint()
            elif op == R.STR:
                r.varint(), r.varint()
            else:
                self.fail('a step of kind %d' % op)
        self.assertLessEqual(made, size)


if __name__ == '__main__':
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
