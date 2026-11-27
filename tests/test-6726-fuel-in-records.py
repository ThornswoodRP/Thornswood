"""
test-6726-fuel-in-records.py

#6726, Patrick's B: the charcoal a forge, skyforge or smelter recipe burns,
and the Tool Handle a hafted weapon takes, are inputs on the recipe, so the
game's own crafting menu names them and takes them. scripts/dev/Build-FuelTable.js
says which recipe takes which (FUEL_BY_RECIPE, [grade, metal, bench, handle]),
and scripts/mods/Build-LastPlugin.py writes them into every recipe it copies;
one of a plugin it never copies is handed to each game instead
(RECIPES_FUELED_IN_GAME). This holds the builder's half on small records made
here, without the game:

  1  fuel_entries: a copied recipe takes its grade's item, and the handle
     when the table says so; a never-copied plugin's recipe, or one it wins,
     goes to each game with its name, output, bench (the one it is moved to,
     when it is moved in each game too), its record's inputs and what to add;
     a recipe nobody has, or a grade the table cannot give, stops the build;
  2  add_inputs: a new input is a CNTO after the last input and its COED, an
     input the record already names asks that many more, COCT is the count,
     and nothing else changes; a record with no COCT stops the build;
  3  with_adds is add_inputs on a list of (item, count), in the same order,
     which is what verify holds the plugin to;
  4  the table each game reads is the manifest's fuelInGame, and the counts
     and the --check and the writes name it;
  5  the item each grade is: Poor Charcoal, Skyrim's own Charcoal, the
     briquette and coke, and the handle, as Build-FuelTable.js has them.

    python tests/test-6726-fuel-in-records.py

Prints PASS or FAIL per check and exits 1 when any fails.
"""
import importlib.util
import json
import os
import struct
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
spec = importlib.util.spec_from_file_location('build_last', os.path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py'))
bl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bl)

passed = failed = 0


def yes(what, ok):
    global passed, failed
    if ok:
        passed += 1
        print('PASS  ' + what)
    else:
        failed += 1
        print('FAIL  ' + what)


def stops(fn, *a):
    try:
        fn(*a)
    except SystemExit as x:
        return str(x)
    return ''


IRON = 0x5ACE4
STEEL = 0x5ACE5
FORGE = 0x88105
SKYFORGE = 0xF46CE


def cobj(edid, inputs, out, bench, coed=False):
    pairs = [(b'EDID', edid.encode() + b'\x00'), (b'COCT', struct.pack('<I', len(inputs)))]
    for fid, n in inputs:
        pairs.append((b'CNTO', struct.pack('<Ii', fid, n)))
        if coed:
            pairs.append((b'COED', b'\x00' * 12))
    pairs += [(b'CTDA', b'\x00' * 32), (b'CNAM', struct.pack('<I', out)), (b'BNAM', struct.pack('<I', bench)),
              (b'NAM1', struct.pack('<H', 1))]
    return pairs


class FakePlugin(object):
    def __init__(self, name, index, records):
        self.name, self.index, self.masters = name, index, []
        self.records = records

    def gid(self, fid):
        return ('skyrim.esm', fid & 0xFFFFFF) if fid >> 24 == 0 else (self.name.lower(), fid & 0xFFFFFF)

    def data(self, e):
        return bl.pack_subrecords(self.records[e.fid])


def entry(fid, pi):
    return bl.Entry(b'COBJ', 0, fid, 0, 0, None, pi)


IA = 'Hothtrooper44_ArmorCompilation.esp'
sky = FakePlugin('Skyrim.esm', 0, {
    0x10: cobj('RecipeIronMace', [(IRON, 2)], 0x13982, FORGE),
    0x11: cobj('RecipeSteelSword', [(STEEL, 2), (IRON, 1)], 0x13989, FORGE),
})
ia = FakePlugin(IA, 1, {
    0x01000020: cobj('IARShieldWolf', [(STEEL, 3)], 0x010214A1, SKYFORGE),
    0x14: cobj('IAWinsThis', [(IRON, 1)], 0x13983, FORGE),
})
plugins = [sky, ia]
canon = {'skyrim.esm': 'Skyrim.esm', IA.lower(): IA, 'thornswood-content.esp': 'Thornswood-Content.esp'}
blocked = {IA.lower()}
win = {
    (b'COBJ', ('skyrim.esm', 0x10)): entry(0x10, 0),
    (b'COBJ', ('skyrim.esm', 0x11)): entry(0x11, 0),
    (b'COBJ', (IA.lower(), 0x20)): entry(0x01000020, 1),
    # A Skyrim recipe the never-copied plugin wins.
    (b'COBJ', ('skyrim.esm', 0x14)): entry(0x14, 1),
}
fuel = {
    '10:Skyrim.esm': [1, 'iron', 'forge', 1],
    '11:Skyrim.esm': [1, 'steel', 'forge', 0],
    '20:' + IA: [1, 'steel', 'skyforge', 0],
    '14:Skyrim.esm': [2, '', 'forge', 1],
}
catalogue = {'20:' + IA: {'name': 'Wolf Shield'}, '14:Skyrim.esm': {'name': 'Iron Thing'}}
moved = [{'recipe': '14:Skyrim.esm', 'to': '6ce000:Update.esm'}]


def never(tag, g):
    return False


# 1
here, in_game = bl.fuel_entries(fuel, catalogue, plugins, win, canon, blocked, never, moved)
got = {desc: add for _, add, desc in here}
yes('1 the two copied recipes take their grade\'s item, and the mace its handle too',
    got == {'10:Skyrim.esm': [('15481:Thornswood-Content.esp', 1), ('15490:Thornswood-Content.esp', 1)],
            '11:Skyrim.esm': [('15481:Thornswood-Content.esp', 1)]})
rows = {r['recipe']: r for r in in_game}
yes('1 the never-copied plugin\'s recipe and the one it wins go to each game instead', sorted(rows) == ['14:Skyrim.esm', '20:' + IA])
yes('1 each with its name, output, bench and inputs as the record asks them, and what to add',
    rows['20:' + IA] == {'recipe': '20:' + IA, 'name': 'Wolf Shield', 'out': '214a1:' + IA, 'bench': 'f46ce:Skyrim.esm',
                         'inputs': [['5ace5:Skyrim.esm', 3]], 'add': [['15481:Thornswood-Content.esp', 1]]})
yes('1 one moved to its trade\'s bench in each game is at that bench, and takes Skyrim\'s Charcoal and a handle',
    rows['14:Skyrim.esm']['bench'] == '6ce000:Update.esm' and
    rows['14:Skyrim.esm']['add'] == [['33760:Skyrim.esm', 1], ['15490:Thornswood-Content.esp', 1]])
here2, in_game2 = bl.fuel_entries(fuel, catalogue, plugins, win, canon, blocked, lambda tag, g: True, moved)
yes('1 a recipe the policy carries from a never-copied plugin is copied, and given them here',
    len(here2) == 4 and in_game2 == [])
yes('1 a recipe no plugin has stops the build',
    'no plugin has it' in stops(bl.fuel_entries, {'99:Skyrim.esm': [1, '', 'forge', 0]}, {}, plugins, win, canon, blocked,
                                never, []))
yes('1 a grade the table cannot give stops the build',
    'grade' in stops(bl.fuel_entries, {'10:Skyrim.esm': [5, '', 'forge', 0]}, {}, plugins, win, canon, blocked, never, []))

# 2
CHARCOAL, HANDLE = 0x33760, 0x5015490
mace = cobj('RecipeIronMace', [(IRON, 2)], 0x13982, FORGE)
out = bl.add_inputs(mace, [(CHARCOAL, 1), (HANDLE, 1)], 'mace')
yes('2 the charcoal and the handle are CNTOs after the last input, COCT says 3, and nothing else changes',
    [t for t, _ in out] == [b'EDID', b'COCT', b'CNTO', b'CNTO', b'CNTO', b'CTDA', b'CNAM', b'BNAM', b'NAM1'] and
    out[1] == (b'COCT', struct.pack('<I', 3)) and out[2] == mace[2] and
    out[3] == (b'CNTO', struct.pack('<Ii', CHARCOAL, 1)) and out[4] == (b'CNTO', struct.pack('<Ii', HANDLE, 1)) and
    out[5:] == mace[3:])
coed = cobj('WithCoed', [(IRON, 1), (STEEL, 1)], 0x1, FORGE, coed=True)
out = bl.add_inputs(coed, [(CHARCOAL, 1)], 'coed')
yes('2 a new input goes after the last input\'s COED, not between an input and its own',
    [t for t, _ in out][:8] == [b'EDID', b'COCT', b'CNTO', b'COED', b'CNTO', b'COED', b'CNTO', b'CTDA'])
has = cobj('HasCharcoal', [(IRON, 1), (CHARCOAL, 2)], 0x1, FORGE)
out = bl.add_inputs(has, [(CHARCOAL, 1)], 'has')
yes('2 an input the record already names asks one more, and COCT stays',
    out[3] == (b'CNTO', struct.pack('<Ii', CHARCOAL, 3)) and out[1] == (b'COCT', struct.pack('<I', 2)) and len(out) == len(has))
yes('2 a record with no COCT stops the build',
    'COCT' in stops(bl.add_inputs, [p for p in mace if p[0] != b'COCT'], [(CHARCOAL, 1)], 'no coct'))


# 3
def cnto(pairs):
    return [struct.unpack('<Ii', b) for t, b in pairs if t == b'CNTO']


for name, rec, add in (('mace', mace, [(CHARCOAL, 1), (HANDLE, 1)]), ('has', has, [(CHARCOAL, 1)]),
                       ('coed', coed, [(HANDLE, 1), (CHARCOAL, 1)])):
    yes('3 with_adds is add_inputs on the inputs alone (%s)' % name,
        [tuple(i) for i in bl.with_adds(cnto(rec), add)] == cnto(bl.add_inputs(rec, add, name)))

# 4
manifest = {'fuelInGame': in_game}
table = json.loads(bl.fueled_table(manifest))
yes('4 the table each game reads is the manifest\'s fuelInGame, by recipe',
    sorted(table) == ['14:Skyrim.esm', '20:' + IA] and
    table['20:' + IA] == {'name': 'Wolf Shield', 'out': '214a1:' + IA, 'bench': 'f46ce:Skyrim.esm',
                          'inputs': [['5ace5:Skyrim.esm', 3]], 'add': [['15481:Thornswood-Content.esp', 1]]})
src = open(os.path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py'), encoding='utf-8').read()
yes('4 the build writes the table, --check compares it, and the counts name both halves',
    "gamemode_tables.write('RECIPES_FUELED_IN_GAME', fueled_table(manifest), args.tables)" in src and
    "gamemode_tables.is_current('RECIPES_FUELED_IN_GAME', fueled_table(manifest), args.tables)" in src and
    "'recipesFueled': len(fuels)" in src and "'recipesFueledInGame': len(fueled_in_game)" in src)
chain = json.load(open(os.path.join(ROOT, 'scripts', 'mods', 'content-tables.json'), encoding='utf-8'))
step = [s for s in chain['steps'] if s['tool'] == 'scripts/mods/Build-LastPlugin.py'][0]
fuel_step = [i for i, s in enumerate(chain['steps']) if s['tool'] == 'scripts/dev/Build-FuelTable.js'][0]
yes('4 the content chain has the plugin read FUEL_BY_RECIPE, after the step that writes it, and write the new table',
    'game/gamemode-tables/FUEL_BY_RECIPE.json' in step['reads'] and
    'game/gamemode-tables/RECIPES_FUELED_IN_GAME.json' in step['writes'] and
    fuel_step < chain['steps'].index(step))

# 5
node = subprocess.run(['node', '-e', 'const f=require(process.argv[1]);console.log(JSON.stringify([f.GRADE_ITEMS,f.HANDLE]))',
                       os.path.join(ROOT, 'scripts', 'dev', 'Build-FuelTable.js')], capture_output=True, text=True)
try:
    grades, handle = json.loads(node.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    grades, handle = None, None
yes('5 the item each grade is and the handle are Build-FuelTable.js\'s',
    grades == list(bl.GRADE_ITEMS) and handle == bl.HANDLE)
yes('5 the Charcoal grade is Skyrim\'s own Charcoal', bl.GRADE_ITEMS[2] == '33760:Skyrim.esm')

print('\n%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
