"""
hidden-recipes-cases.py

#4509. Patrick, 9 Nov 2026, option A on the instruments card: the flute,
lute and drum people own are Skyrim's own, which cannot be equipped, not
PlayFluteLuteDrum.esp's weapons, whose equip and playing are record scripts
our client never runs. That plugin's three recipes turn Skyrim's instruments
into the weapons, and it loads after Thornswood-Content.esp, so only
Thornswood-Last.esp can keep them out of every bench's list.

scripts/mods/Build-LastPlugin.py hides the recipes the policy names under
recipesHidden: each is copied with the condition that is never true among
its conditions. This holds that on small records made here, without the
game:

  1  hiding puts the condition after the recipe's last condition and the
     strings that follow it, or before its output when it has none, and
     leaves every other subrecord as it was; a recipe already hidden is
     refused, so the copy never carries it twice;
  2  over a load order: a named recipe is found as its winner, and one
     that no plugin has, one deleted, one whose editor id is not the
     policy's, and one a never-copied plugin wins each stop the build;
  3  the policy names PlayFluteLuteDrum.esp's three, by form id and editor
     id, with the reason.

    python tests/hidden-recipes-cases.py

tests/test-4509-hidden-recipes.js runs it on the build check.

Prints PASS or FAIL per check and exits 1 when any fails.
"""
import importlib.util
import json
import os
import struct

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


def ctda(func, value=1.0):
    return struct.pack('<B3sfHHIIIIi', 0, b'\x00\x00\x00', value, func, 0, 0, 0, 0, 0, -1)


has = all(hasattr(bl, n) for n in ('hide_recipe', 'hidden_entries'))
yes('the builder has hide_recipe and hidden_entries', has)

if has:
    # 1
    lute = [(b'EDID', b'RecipeWeaponLute\x00'), (b'COCT', struct.pack('<I', 1)),
            (b'CNTO', struct.pack('<Ii', 0xDABAB, 1)), (b'CNAM', struct.pack('<I', 0x01001D9B)),
            (b'BNAM', struct.pack('<I', 0x88105)), (b'NAM1', struct.pack('<H', 1))]
    out = bl.hide_recipe(lute, 't')
    yes('1 a recipe with no condition gets the one that is never true, before its output',
        out == lute[:3] + [(b'CTDA', bl.NEVER_TRUE)] + lute[3:])
    cond = lute[:3] + [(b'CTDA', ctda(659)), (b'CIS1', b'k\x00')] + lute[3:]
    yes('1 a recipe with conditions gets it after the last one and its strings',
        bl.hide_recipe(cond, 't') == cond[:5] + [(b'CTDA', bl.NEVER_TRUE)] + cond[5:])
    yes('1 a recipe already carrying it is refused', 'already' in stops(bl.hide_recipe, out, 't'))

    # 2: a small load order, the way build() hands it over.
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

    sky = FakePlugin('Skyrim.esm', 0, {})
    pfld = FakePlugin('PlayFluteLuteDrum.esp', 1, {0x01002DE4: lute, 0x01001838: lute})
    ia = FakePlugin('Hothtrooper44_ArmorCompilation.esp', 2, {0x02002DE5: lute})
    plugins = [sky, pfld, ia]
    canon = {'skyrim.esm': 'Skyrim.esm', 'playflutelutedrum.esp': 'PlayFluteLuteDrum.esp',
             'hothtrooper44_armorcompilation.esp': 'Hothtrooper44_ArmorCompilation.esp'}
    blocked = {'hothtrooper44_armorcompilation.esp'}
    win = {
        (b'COBJ', ('playflutelutedrum.esp', 0x2DE4)): entry(0x01002DE4, 1),
        (b'COBJ', ('playflutelutedrum.esp', 0x1838)): entry(0x01001838, 1, bl.DELETED),
        (b'COBJ', ('playflutelutedrum.esp', 0x2DE5)): entry(0x02002DE5, 2),
    }

    def policy(*rows):
        return {'recipesHidden': {'why': 'test', 'recipes': [{'recipe': r, 'edid': e} for r, e in rows]}}

    got = bl.hidden_entries(policy(('2de4:PlayFluteLuteDrum.esp', 'RecipeWeaponLute')), plugins, win, canon, blocked)
    yes('2 a named recipe is found as its winner', [e.fid for e, _ in got] == [0x01002DE4])
    yes('2 a policy with none names nothing', bl.hidden_entries({}, plugins, win, canon, blocked) == [])
    yes('2 one no plugin has stops the build',
        'no plugin has' in stops(bl.hidden_entries, policy(('9999:PlayFluteLuteDrum.esp', 'RecipeWeaponLute')),
                                 plugins, win, canon, blocked))
    yes('2 one deleted stops the build',
        'deleted' in stops(bl.hidden_entries, policy(('1838:PlayFluteLuteDrum.esp', 'RecipeWeaponLute')),
                           plugins, win, canon, blocked))
    yes('2 one whose editor id is not the policy\'s stops the build',
        'not the recipe' in stops(bl.hidden_entries, policy(('2de4:PlayFluteLuteDrum.esp', 'RecipeWeaponFlute')),
                                  plugins, win, canon, blocked))
    yes('2 one a never-copied plugin wins stops the build',
        'never copies' in stops(bl.hidden_entries, policy(('2de5:PlayFluteLuteDrum.esp', 'RecipeWeaponLute')),
                                plugins, win, canon, blocked))

# 3
doc = json.load(open(os.path.join(ROOT, 'game', 'data', 'last-plugin-policy.json'), encoding='utf-8'))
hidden = (doc.get('recipesHidden') or {})
rows = {(r.get('recipe'), r.get('edid')) for r in hidden.get('recipes', [])}
yes('3 the policy hides PlayFluteLuteDrum.esp\'s flute, lute and drum recipes, with the reason',
    {('1838:PlayFluteLuteDrum.esp', 'RecipeWeaponFlute'), ('2de4:PlayFluteLuteDrum.esp', 'RecipeWeaponLute'),
     ('2de5:PlayFluteLuteDrum.esp', 'RecipeWeaponDrum')} <= rows and bool(hidden.get('why')))

print('')
print('%d passed, %d failed' % (passed, failed))
raise SystemExit(1 if failed else 0)
