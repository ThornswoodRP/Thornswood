"""
perks-off-cases.py

#4826 (Patrick, 22 Oct 2026, B: the whole vanilla perk system goes, not only
the recipe perk conditions). Nobody here holds a vanilla perk, so a recipe
whose record tests one (HasPerk, condition function 448) was hidden by the
crafting menu from everybody, whatever the server allowed.
scripts/mods/Build-LastPlugin.py now takes every perk test out of every
winning recipe in Thornswood-Last.esp, and scripts/dev/Build-RecipeTable.ps1
reads that end state. This holds the plugin builder's part on small records
made here, without the game:

  1  a perk test is found, and so is one joined to another condition by OR,
     by its own OR flag or the one of the condition before it;
  2  taking the tests out leaves every other subrecord as it was, in order,
     and takes the CIS1 and CIS2 that follow a test with it;
  3  a perk test joined by OR takes its whole OR group off, and nothing
     of the groups around it (Skyrim joins OR before AND); a record that
     tests no perk is refused;
  4  over a load order: a winning recipe that tests a perk is chosen, a
     deleted one, one that tests none, and one of a never-copied plugin are
     not (that one is counted), unless that plugin's row says
     perkRecipesCopied, as Immersive Armors' does, and one joined by OR
     is chosen too and counted under joinedGroups;
  5  the recipe table reads the same end state: it takes the policy's
     never-copied plugins, reads conditions from below the last plugin, and
     its PerkDropsOf, run under pwsh where there is one, drops the same
     OR groups.

    python tests/perks-off-cases.py

tests/test-4826-perks-off.js runs it on the build check.

Prints PASS or FAIL per check and exits 1 when any fails.
"""
import importlib.util
import json
import os
import struct
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


def ctda(func, param=0, value=1.0, op=0, or_=False):
    """A 32 byte condition: operator in the top three bits, OR in bit 0."""
    first = (op << 5) | (bl.CTDA_OR if or_ else 0)
    return struct.pack('<B3sfHHIIIIi', first, b'\x00\x00\x00', value, func, 0, param, 0, 0, 0, -1)


PERK = 0x000CB40D       # SteelSmithing in Skyrim.esm's numbering
OTHER = 659             # a function that is not HasPerk
recipe = [
    (b'EDID', b'RecipeSteelHelmet\x00'),
    (b'COCT', struct.pack('<I', 1)),
    (b'CNTO', struct.pack('<Ii', 0x5ACE5, 2)),
    (b'CTDA', ctda(OTHER, value=1.0, op=1)),
    (b'CTDA', ctda(bl.HAS_PERK, PERK)),
    (b'CIS1', b'x\x00'),
    (b'CIS2', b'y\x00'),
    (b'CTDA', ctda(bl.HAS_PERK, PERK + 1, value=0.0)),
    (b'CNAM', struct.pack('<I', 0x13950)),
    (b'BNAM', struct.pack('<I', 0x88105)),
    (b'NAM1', struct.pack('<H', 1)),
]

# 1
at, joined = bl.perk_tests(recipe)
yes('1 both perk tests are found, and neither is joined by OR', at == [4, 7] and not joined)
yes('1 a perk test with its own OR flag is joined',
    bl.perk_tests([(b'CTDA', ctda(bl.HAS_PERK, PERK, or_=True)), (b'CTDA', ctda(OTHER))])[1])
yes('1 a perk test after a condition with the OR flag is joined',
    bl.perk_tests([(b'CTDA', ctda(OTHER, or_=True)), (b'CTDA', ctda(bl.HAS_PERK, PERK))])[1])
yes('1 an OR between two other conditions does not join a perk test after them',
    not bl.perk_tests([(b'CTDA', ctda(OTHER, or_=True)), (b'CTDA', ctda(OTHER)),
                       (b'CTDA', ctda(bl.HAS_PERK, PERK))])[1])

# 2
out = bl.without_perks(recipe, 'test COBJ')
yes('2 the perk tests and their CIS1 and CIS2 are gone, everything else as it was, in order',
    out == [recipe[i] for i in (0, 1, 2, 3, 8, 9, 10)])
yes('2 a CIS1 after a condition that stays is kept',
    bl.without_perks([(b'CTDA', ctda(OTHER)), (b'CIS1', b'k\x00'), (b'CTDA', ctda(bl.HAS_PERK, PERK))], 't')
    == [(b'CTDA', ctda(OTHER)), (b'CIS1', b'k\x00')])

# 3
yes('3 a record that tests no perk is refused', 'tests no perk' in stops(bl.without_perks, recipe[:4], 't'))
# Tempering's shape: (not enchanted OR a perk) AND a perk, then a group
# with no perk: (a OR b) AND c, so the first group and the lone perk go and
# the last group stays, its OR flags and its CIS1 untouched.
enchanted = ctda(OTHER, value=0.0, or_=True)
arcane = ctda(bl.HAS_PERK, PERK + 1)
smith = ctda(bl.HAS_PERK, PERK)
keep_a, keep_b = ctda(OTHER + 1, or_=True), ctda(OTHER + 2)
temper = [(b'EDID', b'Temper\x00'), (b'CTDA', enchanted), (b'CTDA', arcane), (b'CIS2', b'x\x00'),
          (b'CTDA', smith), (b'CTDA', keep_a), (b'CIS1', b'k\x00'), (b'CTDA', keep_b)]
yes('3 an OR group holding a perk test comes off whole, with its strings',
    bl.perk_drops(temper) == [1, 2, 4] and
    bl.without_perks(temper, 't') == [temper[0], temper[5], temper[6], temper[7]])
yes('3 a perk test first in its group takes the rest of the group with it',
    bl.without_perks([(b'CTDA', ctda(bl.HAS_PERK, PERK, or_=True)), (b'CTDA', ctda(OTHER)), (b'CTDA', ctda(OTHER + 1))], 't')
    == [(b'CTDA', ctda(OTHER + 1))])
yes('3 a last condition carrying OR ends its group',
    bl.perk_drops([(b'CTDA', ctda(OTHER)), (b'CTDA', ctda(bl.HAS_PERK, PERK, or_=True))]) == [1])


# 4: a small load order, the way build() hands it over.
class FakePlugin(object):
    def __init__(self, name, index, records):
        self.name, self.index, self.masters = name, index, []
        self.records = records

    def gid(self, fid):
        return ('skyrim.esm', fid & 0xFFFFFF) if fid >> 24 == 0 else (self.name.lower(), fid & 0xFFFFFF)

    def data(self, e):
        return bl.pack_subrecords(self.records[e.fid])


def entry(fid, pi, flags=0):
    return bl.Entry(b'COBJ', flags, fid, 0, 0, None, pi)


plain = [(b'EDID', b'Plain\x00'), (b'CTDA', ctda(OTHER))]
perky = [(b'EDID', b'Perky\x00'), (b'CTDA', ctda(bl.HAS_PERK, PERK))]
ored = [(b'EDID', b'Ored\x00'), (b'CTDA', ctda(OTHER, or_=True)), (b'CTDA', ctda(bl.HAS_PERK, PERK))]
sky = FakePlugin('Skyrim.esm', 0, {0x10: perky, 0x11: plain, 0x12: perky, 0x14: perky})
ia = FakePlugin('Hothtrooper44_ArmorCompilation.esp', 1, {0x01000020: perky})
plugins = [sky, ia]
canon = {'skyrim.esm': 'Skyrim.esm', 'hothtrooper44_armorcompilation.esp': 'Hothtrooper44_ArmorCompilation.esp'}
blocked = {'hothtrooper44_armorcompilation.esp'}
win = {
    (b'COBJ', ('skyrim.esm', 0x10)): entry(0x10, 0),
    (b'COBJ', ('skyrim.esm', 0x11)): entry(0x11, 0),
    (b'COBJ', ('skyrim.esm', 0x12)): entry(0x12, 0, bl.DELETED),
    (b'COBJ', ('hothtrooper44_armorcompilation.esp', 0x20)): entry(0x01000020, 1),
    # A Skyrim recipe the never-copied plugin wins.
    (b'COBJ', ('skyrim.esm', 0x14)): entry(0x14, 1),
    (b'CELL', ('skyrim.esm', 0x99)): bl.Entry(b'CELL', 0, 0x99, 0, 0, None, 0),
}
ia.records[0x14] = perky
here, stats = bl.perk_entries(plugins, win, canon, blocked)
yes('4 only the winning Skyrim recipe that tests a perk is chosen', [e.fid for e in here] == [0x10])
yes('4 the manifest counts it, its condition, its winner and the perk tested',
    stats['recipes'] == 1 and stats['conditions'] == 1 and stats['byWinner'] == {'Skyrim.esm': 1} and
    stats['tested'] == {'cb40d:Skyrim.esm': 1})
yes('4 the never-copied plugin keeps its own recipe and the one it wins, counted',
    stats['notCopied'] == {'Hothtrooper44_ArmorCompilation.esp': 2})
# Immersive Armors' row says perkRecipesCopied (Patrick, 31 Oct 2026, A on
# q-4826-ia-perk-recipes): its recipes that test a perk are copied the same
# way, and counted as copied from a never-copied plugin.
here, stats = bl.perk_entries(plugins, win, canon, blocked, frozenset(blocked))
yes('4 with perkRecipesCopied, its own perk recipe and the one it wins are copied too',
    sorted(e.fid for e in here) == [0x10, 0x14, 0x01000020] and stats['notCopied'] == {} and
    stats['byWinner'] == {'Skyrim.esm': 1, 'Hothtrooper44_ArmorCompilation.esp': 2} and
    stats['copiedFromNeverCopied'] == {'Hothtrooper44_ArmorCompilation.esp': 2})
yes('4 the copy has only its perk test taken out',
    bl.without_perks(perky, 'IA COBJ') == [(b'EDID', b'Perky\x00')])
policy = json.load(open(os.path.join(ROOT, 'game', 'data', 'last-plugin-policy.json'), encoding='utf-8'))
yes('4 the policy copies Immersive Armors\' perk recipes and no other never-copied plugin\'s',
    bl.perk_recipes_copied(policy) == frozenset({'hothtrooper44_armorcompilation.esp'}) and
    bl.perk_recipes_copied({'notCopiedFrom': [{'plugin': 'X.esp'}, {'plugin': 'Y.esp', 'perkRecipesCopied': 'yes'}]})
    == frozenset())
yes('4 a recipe kept by one blocked plugin stays kept even when the other copies',
    bl.perks_kept('Hothtrooper44_ArmorCompilation.esp', ('x.esp', 1), {'x.esp', 'hothtrooper44_armorcompilation.esp'},
                  frozenset({'hothtrooper44_armorcompilation.esp'})) and
    not bl.perks_kept('Hothtrooper44_ArmorCompilation.esp', ('skyrim.esm', 1), {'hothtrooper44_armorcompilation.esp'},
                      frozenset({'hothtrooper44_armorcompilation.esp'})))
sky.records[0x15] = ored
win[(b'COBJ', ('skyrim.esm', 0x15))] = entry(0x15, 0)
here, stats = bl.perk_entries(plugins, win, canon, blocked)
yes('4 a winning recipe that joins a perk test by OR is chosen and counted under joinedGroups',
    0x15 in [e.fid for e in here] and stats['joinedGroups'] == {'recipes': 1, 'otherConditions': 1} and
    stops(bl.perk_entries, plugins, win, canon, blocked) == '')

# 5: the recipe table's half, read from the script, since it runs only
# against the game's plugins on a machine that has them.
table = open(os.path.join(ROOT, 'scripts', 'dev', 'Build-RecipeTable.ps1'), encoding='utf-8-sig').read()
yes('5 the recipe table takes the never-copied plugins from the last plugin\'s policy',
    "game\\data\\last-plugin-policy.json" in table and '.notCopiedFrom' in table)
yes('5 it keeps the perk tests only of a never-copied plugin whose row does not copy its perk recipes',
    '$row.perkRecipesCopied -ne $true' in table)
yes('5 it never reads Thornswood-Last.esp, so a recipe\'s conditions are the ones its mod gave it (#5191)',
    '$order.RemoveAll([Predicate[string]] { param($p) $p -ieq $LAST_PLUGIN })' in table and
    '$pl -eq $LAST_PLUGIN' not in table)
yes('5 a condition that comes off with the perks is not one of a row\'s needs',
    '$perkDrops = if ($perksOff) { PerkDropsOf $r } else { @{} }' in table and
    'if ($perkDrops.ContainsKey($at)) { continue }' in table)
yes('5 it no longer fails on a perk test joined by OR', 'join a perk test to another condition by OR' not in table)
# PerkDropsOf itself, lifted out of the script and run under pwsh, against
# the same shapes perk_drops was given above.
import re
import shutil
import subprocess
fn = re.search(r'^function PerkDropsOf\(\$r\) \{.*?^\}', table, re.S | re.M)
pw = shutil.which('pwsh')
if not fn:
    yes('5 the table has a PerkDropsOf', False)
elif not pw:
    print('SKIP  5 PerkDropsOf under pwsh: there is no pwsh here')
else:
    script = '$CONDITION_VANILLA_PERK = 448\n' + fn.group(0) + '''
function C($f, $or) { [pscustomobject]@{ Func = $f; Or = $or } }
$cases = @(
  @(@((C 659 $true), (C 448 $false), (C 448 $false), (C 660 $true), (C 661 $false)), '0,1,2'),
  @(@((C 448 $true), (C 659 $false), (C 660 $false)), '0,1'),
  @(@((C 659 $false), (C 448 $true)), '1'),
  @(@((C 659 $true), (C 660 $false)), ''),
  @(@(), '')
)
foreach ($c in $cases) {
  $got = ((PerkDropsOf ([pscustomobject]@{ Conditions = $c[0] })).Keys | Sort-Object) -join ','
  if ($got -ne $c[1]) { "BAD $got want $($c[1])" } else { 'GOOD' }
}
'''
    r = subprocess.run([pw, '-NoProfile', '-NonInteractive', '-Command', script], capture_output=True, text=True, timeout=120)
    lines = r.stdout.split()
    yes('5 PerkDropsOf drops the same OR groups as perk_drops (%s)' % ' '.join(lines),
        r.returncode == 0 and lines == ['GOOD'] * 5)
yes('5 no half is still named as nobody can start because of the perks',
    "'Cook/Confectioner'     =" not in table)

print('')
print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
