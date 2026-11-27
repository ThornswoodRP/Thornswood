"""
test-6726-fuel-in-records.py

#6726, Patrick's B: the charcoal a forge, skyforge or smelter recipe burns,
and the Tool Handle a hafted weapon takes, are inputs on the recipe, so the
game's own crafting menu names them and takes them. scripts/dev/Build-FuelTable.js
says which recipe takes which (game/data/fuel-by-recipe.json: the item each
grade is, the handle, and per recipe [grade, metal, bench, handle]);
scripts/mods/Build-LastPlugin.py writes them into every recipe it copies, and
scripts/dev/Build-Recost.py puts one of a plugin it never copies in
RECIPES_SET_IN_GAME with them on top, for each game to set. This holds the
builders' half on small records made here, without the game:

  1  fuel_entries: a copied recipe takes its grade's item, and the handle
     when the table says so; a never-copied plugin's recipe, or one it wins,
     is left to each game, and stops the build unless RECIPES_SET_IN_GAME
     holds it with its record's inputs first and what it takes on top; a
     recipe nobody has, or a grade the file cannot give, stops the build;
  2  add_inputs: a new input is a CNTO after the last input and its COED, an
     input the record already names asks that many more, COCT is the count,
     and nothing else changes; a record with no COCT stops the build;
  3  with_adds is add_inputs on a list of (item, count), in the same order,
     which is what verify holds the plugin to;
  4  Build-Recost.py's RECIPES_SET_IN_GAME: a never-copied fueled recipe is
     its inputs [item, had, had], an item it names asking more, then the
     added ones [item, 0, n]; a re-costed one takes them on top of its new
     counts; a carried or a copied one is not in it; a recipe one plugin
     owns and a never-copied one wins (wonBy in recipes.json) is in it and
     held under notCopied, as the plugin's own test says, and the plugin
     builds from that table; and the content chain
     builds the file first, then the table, then the plugin, and nothing
     writes a table of its own for them;
  5  the item each grade is: Poor Charcoal, Skyrim's own Charcoal, the
     briquette and coke, and the handle, as Build-FuelTable.js writes them.

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
spec = importlib.util.spec_from_file_location('build_recost', os.path.join(ROOT, 'scripts', 'dev', 'Build-Recost.py'))
br = importlib.util.module_from_spec(spec)
spec.loader.exec_module(br)

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
GRADES = [None, '15481:Thornswood-Content.esp', '33760:Skyrim.esm', '15484:Thornswood-Content.esp',
          '15485:Thornswood-Content.esp']
HANDLE_ITEM = '15490:Thornswood-Content.esp'


def fuel_file(recipes):
    return {'grades': GRADES, 'handle': HANDLE_ITEM, 'recipes': recipes}


fuel = fuel_file({
    '10:Skyrim.esm': [1, 'iron', 'forge', 1],
    '11:Skyrim.esm': [1, 'steel', 'forge', 0],
    '20:' + IA: [1, 'steel', 'skyforge', 0],
    '14:Skyrim.esm': [2, '', 'forge', 1],
})
set_in_game = {
    '20:' + IA: {'inputs': [['5ace5:Skyrim.esm', 3, 3], ['15481:Thornswood-Content.esp', 0, 1]]},
    '14:Skyrim.esm': {'inputs': [['5ace4:Skyrim.esm', 1, 1], ['33760:Skyrim.esm', 0, 1], [HANDLE_ITEM, 0, 1]]},
}


def never(tag, g):
    return False


# 1
here, in_game = bl.fuel_entries(fuel, set_in_game, plugins, win, canon, blocked, never)
got = {desc: add for _, add, desc in here}
yes('1 the two copied recipes take their grade\'s item, and the mace its handle too',
    got == {'10:Skyrim.esm': [('15481:Thornswood-Content.esp', 1), ('15490:Thornswood-Content.esp', 1)],
            '11:Skyrim.esm': [('15481:Thornswood-Content.esp', 1)]})
yes('1 the never-copied plugin\'s recipe and the one it wins are left to each game, with what each takes on top',
    sorted(in_game, key=lambda r: r['recipe']) ==
    [{'recipe': '14:Skyrim.esm', 'add': [['33760:Skyrim.esm', 1], [HANDLE_ITEM, 1]]},
     {'recipe': '20:' + IA, 'add': [['15481:Thornswood-Content.esp', 1]]}])
short = dict(set_in_game)
del short['14:Skyrim.esm']
yes('1 one RECIPES_SET_IN_GAME does not hold stops the build, naming Build-Recost.py',
    'Build-Recost.py' in stops(bl.fuel_entries, fuel, short, plugins, win, canon, blocked, never))
other = dict(set_in_game, **{'20:' + IA: {'inputs': [['5ace5:Skyrim.esm', 2, 2], ['15481:Thornswood-Content.esp', 0, 1]]}})
yes('1 so does one it holds with other inputs than the record\'s',
    'Build-Recost.py' in stops(bl.fuel_entries, fuel, other, plugins, win, canon, blocked, never))
bare = dict(set_in_game, **{'20:' + IA: {'inputs': [['5ace5:Skyrim.esm', 3, 3]]}})
yes('1 and one it holds without the charcoal',
    'Build-Recost.py' in stops(bl.fuel_entries, fuel, bare, plugins, win, canon, blocked, never))
here2, in_game2 = bl.fuel_entries(fuel, {}, plugins, win, canon, blocked, lambda tag, g: True)
yes('1 a recipe the policy carries from a never-copied plugin is copied, and given them here',
    len(here2) == 4 and in_game2 == [])
yes('1 a recipe no plugin has stops the build',
    'no plugin has it' in stops(bl.fuel_entries, fuel_file({'99:Skyrim.esm': [1, '', 'forge', 0]}), {}, plugins, win,
                                canon, blocked, never))
yes('1 a grade the file cannot give stops the build',
    'grade' in stops(bl.fuel_entries, fuel_file({'10:Skyrim.esm': [5, '', 'forge', 0]}), {}, plugins, win, canon,
                     blocked, never))

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
policy = {'notCopiedFrom': [{'plugin': IA, 'carried': ['COBJ 30:' + IA]}]}
recipes = {'recipes': {
    '20:' + IA: {'name': 'Wolf Shield', 'out': '214a1:' + IA, 'bench': 'f46ce:Skyrim.esm',
                 'inputItems': [{'item': '5ace5:Skyrim.esm', 'name': 'Steel Ingot', 'count': 3}]},
    '21:' + IA: {'name': 'Iron Axe', 'out': '214a2:' + IA, 'bench': '88105:Skyrim.esm',
                 'inputItems': [{'item': '5ace4:Skyrim.esm', 'count': 2}, {'item': '33760:Skyrim.esm', 'count': 1}]},
    '22:' + IA: {'name': 'Steel Buckler', 'out': '214a3:' + IA, 'bench': '88105:Skyrim.esm', 'inputItems': []},
    '30:' + IA: {'name': 'Carried', 'out': '214a5:' + IA, 'bench': '88105:Skyrim.esm', 'inputItems': []},
    '10:Skyrim.esm': {'name': 'Iron Mace', 'out': '13982:Skyrim.esm', 'bench': '88105:Skyrim.esm', 'inputItems': []},
}}
data = {'notCopied': [{'recipe': '22:' + IA, 'name': 'Steel Buckler', 'inputs': [
    {'item': '5ace5:Skyrim.esm', 'count': 1, 'to': 2}, {'item': 'f:Skyrim.esm', 'count': 50, 'to': 0}]}]}
rsig = json.loads(br.in_game_table(data, recipes, fuel_file({
    '20:' + IA: [1, 'steel', 'skyforge', 0], '21:' + IA: [2, 'iron', 'forge', 1],
    '22:' + IA: [1, 'steel', 'forge', 0], '30:' + IA: [1, '', 'forge', 0], '10:Skyrim.esm': [1, 'iron', 'forge', 1]}),
    policy))
yes('4 a never-copied fueled recipe is its inputs [item, had, had], then the charcoal [item, 0, 1]',
    rsig['20:' + IA] == {'name': 'Wolf Shield', 'out': '214a1:' + IA, 'bench': 'f46ce:Skyrim.esm',
                         'inputs': [['5ace5:Skyrim.esm', 3, 3], ['15481:Thornswood-Content.esp', 0, 1]]})
yes('4 an added item it names asks one more, and the handle comes after',
    rsig['21:' + IA]['inputs'] == [['5ace4:Skyrim.esm', 2, 2], ['33760:Skyrim.esm', 1, 2], [HANDLE_ITEM, 0, 1]])
yes('4 a re-costed one takes the charcoal on top of its new counts',
    rsig['22:' + IA]['inputs'] == [['5ace5:Skyrim.esm', 1, 2], ['f:Skyrim.esm', 50, 0],
                                   ['15481:Thornswood-Content.esp', 0, 1]])
yes('4 one the policy carries, and one of a plugin that is copied, are not in it',
    sorted(rsig) == ['20:' + IA, '21:' + IA, '22:' + IA])
yes('4 and the table is the same as before for a load order with no fuel',
    json.loads(br.in_game_table(data, recipes, fuel_file({}), policy)) ==
    {'22:' + IA: {'name': 'Steel Buckler', 'out': '214a3:' + IA, 'bench': '88105:Skyrim.esm',
                  'inputs': [['5ace5:Skyrim.esm', 1, 2], ['f:Skyrim.esm', 50, 0]]}})
# A recipe one plugin owns and a never-copied one wins, the way
# Hothtrooper44_ArmorCompilation.esp wins da0c03:Update.esm: the plugin
# leaves it to each game, so the table has to hold it, and holds it only by
# reading wonBy. Built from 1's load order and handed to 1's fuel_entries.
won_rows = {'recipes': {
    '20:' + IA: {'name': 'Wolf Shield', 'out': '214a1:' + IA, 'bench': 'f46ce:Skyrim.esm', 'wonBy': IA,
                 'inputItems': [{'item': '5ace5:Skyrim.esm', 'name': 'Steel Ingot', 'count': 3}]},
    '14:Skyrim.esm': {'name': 'Iron Dagger', 'out': '13983:Skyrim.esm', 'bench': '88105:Skyrim.esm', 'wonBy': IA,
                      'inputItems': [{'item': '5ace4:Skyrim.esm', 'name': 'Iron Ingot', 'count': 1}]},
    '10:Skyrim.esm': {'name': 'Iron Mace', 'out': '13982:Skyrim.esm', 'bench': '88105:Skyrim.esm',
                      'wonBy': 'Skyrim.esm', 'inputItems': []},
}}
ia_policy = {'notCopiedFrom': [{'plugin': IA}]}
won_table = json.loads(br.in_game_table({'notCopied': []}, won_rows, fuel, ia_policy))
yes('4 a recipe a never-copied plugin wins is in it, with its inputs and what it takes on top',
    won_table.get('14:Skyrim.esm') == {'name': 'Iron Dagger', 'out': '13983:Skyrim.esm', 'bench': '88105:Skyrim.esm',
                                       'inputs': [['5ace4:Skyrim.esm', 1, 1], ['33760:Skyrim.esm', 0, 1],
                                                  [HANDLE_ITEM, 0, 1]]} and
    sorted(won_table) == ['14:Skyrim.esm', '20:' + IA])
yes('4 and the plugin builds from that table, leaving both to each game',
    stops(bl.fuel_entries, fuel, won_table, plugins, win, canon, blocked, never) == '' and
    sorted(r['recipe'] for r in bl.fuel_entries(fuel, won_table, plugins, win, canon, blocked, never)[1]) ==
    ['14:Skyrim.esm', '20:' + IA])
owner_only = {'recipes': {k: {f: v for f, v in r.items() if f != 'wonBy'} for k, r in won_rows['recipes'].items()}}
yes('4 read by its owner alone, the table misses it and the plugin stops (the content builds after #7072)',
    'Build-Recost.py' in stops(bl.fuel_entries, fuel, json.loads(br.in_game_table({'notCopied': []}, owner_only, fuel,
                                                                                 ia_policy)),
                               plugins, win, canon, blocked, never))
GOLD = {'item': 'f:Skyrim.esm', 'name': 'Gold', 'count': 50}
coins = {'recipes': {
    '40:Skyrim.esm': {'name': 'Won', 'owner': 'Smith', 'benchName': 'CraftingSmithingForge', 'wonBy': IA,
                      'inputItems': [{'item': '5ace4:Skyrim.esm', 'name': 'Iron Ingot', 'count': 2}, GOLD]},
    '41:Skyrim.esm': {'name': 'Own', 'owner': 'Smith', 'benchName': 'CraftingSmithingForge', 'wonBy': 'Skyrim.esm',
                      'inputItems': [{'item': '5ace4:Skyrim.esm', 'name': 'Iron Ingot', 'count': 2}, GOLD]},
    '42:' + IA: {'name': 'Theirs', 'owner': 'Smith', 'benchName': 'CraftingSmithingForge', 'wonBy': IA,
                 'inputItems': [{'item': '5ace4:Skyrim.esm', 'name': 'Iron Ingot', 'count': 2}, GOLD]},
}}
built = br.build(coins, None, ia_policy)
yes('4 a re-costed recipe a never-copied plugin wins is held under notCopied, saying who wins it, as its own are',
    [r['recipe'] for r in built['recipes']] == ['41:Skyrim.esm'] and
    sorted(r['recipe'] for r in built['notCopied']) == ['40:Skyrim.esm', '42:' + IA] and
    IA + ' wins it' in next(r['whyNot'] for r in built['notCopied'] if r['recipe'] == '40:Skyrim.esm'))
with open(os.path.join(ROOT, 'scripts', 'dev', 'Build-RecipeTable.ps1'), encoding='utf-8-sig') as f:
    table_src = f.read()
yes('4 recipes.json writes wonBy, the plugin whose copy the game uses, on owned and unowned rows',
    table_src.count(', "wonBy": \' + (JsonStr $') == 2 and '"wonBy": \' + (JsonStr \'the plugin whose copy' in table_src)
with open(os.path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py'), encoding='utf-8') as f:
    src = f.read()
yes('4 the plugin reads RECIPES_SET_IN_GAME for them, writes no table of its own, and counts both halves',
    "gamemode_tables.read('RECIPES_SET_IN_GAME', tables_dir)" in src and 'FUELED_IN_GAME' not in src and
    "'recipesFueled': len(fuels)" in src and "'recipesFueledInGame': len(fueled_in_game)" in src)
with open(os.path.join(ROOT, 'scripts', 'mods', 'content-tables.json'), encoding='utf-8') as f:
    chain = json.load(f)
order = [s['tool'] for s in chain['steps']]
step = chain['steps'][order.index('scripts/mods/Build-LastPlugin.py')]
recost = chain['steps'][order.index('scripts/dev/Build-Recost.py')]
fuel_step = chain['steps'][order.index('scripts/dev/Build-FuelTable.js')]
yes('4 the content chain builds the file, then RECIPES_SET_IN_GAME from it, then the plugin from both',
    fuel_step['writes'] == ['game/data/fuel-by-recipe.json'] and
    'game/data/fuel-by-recipe.json' in recost['reads'] and
    'game/data/fuel-by-recipe.json' in step['reads'] and
    'game/gamemode-tables/RECIPES_SET_IN_GAME.json' in step['reads'] and
    order.index('scripts/dev/Build-FuelTable.js') < order.index('scripts/dev/Build-Recost.py') <
    order.index('scripts/mods/Build-LastPlugin.py') and
    not any('FUEL' in w for s in chain['steps'] for w in s['writes'] if 'gamemode-tables' in w))

# 5
node = subprocess.run(['node', '-e', 'const f=require(process.argv[1]);console.log(JSON.stringify(JSON.parse(f.fileJson({}))))',
                       os.path.join(ROOT, 'scripts', 'dev', 'Build-FuelTable.js')], capture_output=True, text=True)
try:
    written = json.loads(node.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    written = {}
yes('5 the file names Poor Charcoal, Skyrim\'s own Charcoal, the briquette and coke, and the handle',
    written == {'grades': GRADES, 'handle': HANDLE_ITEM, 'recipes': {}})

print('\n%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
