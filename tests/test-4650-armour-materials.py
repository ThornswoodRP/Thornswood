"""
test-4650-armour-materials.py

#4650. Armour with no material keyword sits under the crafting menu's
Armour header in no group. Which pieces those are, and what each carries,
is measured on the box by scripts/dev/List-ArmourMaterials.py, through the
deploy gate's List-GameData verb. This runs that lister over a data folder
of five made-up masters and checks what it says:

  L1  a piece a recipe makes with ArmorLight and no material keyword the
      config names is listed, with its keywords, its recipe's bench and
      what the recipe takes (by name);
  L2  a piece in a group is not listed, and is counted in its group;
  L3  a piece no recipe makes, and a piece with no Armour header keyword,
      are not listed;
  L4  a later master's copy of a record is the one read;
  L5  a piece two groups claim is named.

Read only, apart from its own temporary folder.
"""

import os
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LISTER = os.path.join(ROOT, 'scripts', 'dev', 'List-ArmourMaterials.py')
passed = failed = 0


def yes(what, cond):
    global passed, failed
    if cond:
        passed += 1
        print('PASS  ' + what)
    else:
        failed += 1
        print('FAIL  ' + what)


def sub(tag, body):
    return tag + struct.pack('<H', len(body)) + body


def z(text):
    return text.encode('ascii') + b'\0'


def record(tag, fid, subs):
    data = b''.join(subs)
    return tag + struct.pack('<IIIIHH', len(data), 0, fid, 0, 44, 0) + data


def group(label, recs):
    body = b''.join(recs)
    return b'GRUP' + struct.pack('<I', 24 + len(body)) + label + struct.pack('<IIHH', 0, 0, 0, 0) + body


def plugin(masters, groups):
    head = sub(b'HEDR', struct.pack('<fII', 1.7, 0, 0x800))
    for m in masters:
        head += sub(b'MAST', z(m)) + sub(b'DATA', struct.pack('<Q', 0))
    return b'TES4' + struct.pack('<IIIIHH', len(head), 0, 0, 0, 44, 0) + head + b''.join(groups)


def kw(fid, edid):
    return record(b'KYWD', fid, [sub(b'EDID', z(edid))])


def armo(fid, edid, name, keywords):
    return record(b'ARMO', fid, [sub(b'EDID', z(edid)), sub(b'FULL', z(name)),
                                 sub(b'KSIZ', struct.pack('<I', len(keywords))),
                                 sub(b'KWDA', b''.join(struct.pack('<I', k) for k in keywords))])


def cobj(fid, edid, out, bench, inputs):
    subs = [sub(b'EDID', z(edid)), sub(b'COCT', struct.pack('<I', len(inputs)))]
    subs += [sub(b'CNTO', struct.pack('<Ii', i, n)) for i, n in inputs]
    subs += [sub(b'CNAM', struct.pack('<I', out)), sub(b'BNAM', struct.pack('<I', bench)),
             sub(b'NAM1', struct.pack('<H', 1))]
    return record(b'COBJ', fid, subs)


def misc(fid, edid, name):
    return record(b'MISC', fid, [sub(b'EDID', z(edid)), sub(b'FULL', z(name))])


LIGHT, CLOTH, LEATHER, IRON, FORGE = 0x900, 0x901, 0x902, 0x903, 0x904
skyrim = plugin([], [
    group(b'KYWD', [kw(LIGHT, 'ArmorLight'), kw(CLOTH, 'ArmorClothing'), kw(LEATHER, 'ArmorMaterialLeather'),
                    kw(IRON, 'ArmorMaterialIron'), kw(FORGE, 'CraftingSmithingForge')]),
    group(b'MISC', [misc(0xa00, 'LeatherStrips', 'Leather Strips'), misc(0xa01, 'Linen', 'Linen Wrap')]),
    group(b'ARMO', [
        armo(0xb00, 'MageHood', 'Mage Hood', [LIGHT]),                 # L1: no group
        armo(0xb01, 'LeatherBoots', 'Leather Boots', [LIGHT, LEATHER]),  # L2: in Leather
        armo(0xb02, 'NobodyMakes', 'Nobody Makes', [LIGHT]),           # L3: no recipe
        armo(0xb03, 'PlainShirt', 'Plain Shirt', [CLOTH]),             # L3: no header
        armo(0xb04, 'Patched', 'Patched', [LIGHT]),                    # L4: Update gives it Iron
        armo(0xb05, 'Twice', 'Twice', [LIGHT, LEATHER, IRON]),         # L5: two groups
    ]),
    group(b'COBJ', [
        cobj(0xc00, 'RecipeMageHood', 0xb00, FORGE, [(0xa01, 2), (0xa00, 1)]),
        cobj(0xc01, 'RecipeLeatherBoots', 0xb01, FORGE, [(0xa00, 1)]),
        cobj(0xc03, 'RecipePlainShirt', 0xb03, FORGE, [(0xa01, 1)]),
        cobj(0xc04, 'RecipePatched', 0xb04, FORGE, [(0xa00, 1)]),
        cobj(0xc05, 'RecipeTwice', 0xb05, FORGE, [(0xa00, 1)]),
    ]),
])
update = plugin(['Skyrim.esm'], [group(b'ARMO', [armo(0xb04, 'Patched', 'Patched', [LIGHT, IRON])])])

with tempfile.TemporaryDirectory() as data:
    files = {'Skyrim.esm': skyrim, 'Update.esm': update}
    for name in ('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'):
        with open(os.path.join(data, name), 'wb') as fh:
            fh.write(files.get(name) or plugin(['Skyrim.esm'], []))
    run = subprocess.run([sys.executable, LISTER, '--data', data], capture_output=True, text=True)
out = run.stdout
lines = out.splitlines()
yes('L0 the lister reads the five masters and exits 0', run.returncode == 0 and 'read 5 plugins of the load order' in out)
hood = [l for l in lines if l.startswith('ARMO') and 'MageHood' in l]
yes('L1 the piece with ArmorLight and no material is listed with its keywords',
    len(hood) == 1 and 'b00:Skyrim.esm' in hood[0] and 'Mage Hood' in hood[0] and 'keywords ArmorLight' in hood[0])
yes('L1 with its recipe, its bench and what it takes, by name',
    any('RecipeMageHood' in l and 'at CraftingSmithingForge' in l and '2 Linen Wrap (a01:Skyrim.esm), 1 Leather Strips (a00:Skyrim.esm)' in l
        for l in lines))
yes('L1 the count of pieces in no group, by plugin',
    '1 armour pieces a recipe makes are under the Armour header in no group' in out and '1 from Skyrim.esm' in out)
yes('L2 a piece in a group is not listed', not any(l.startswith('ARMO') and 'LeatherBoots' in l for l in lines))
yes('L2 and is counted in its group', any(l.strip() == '2 $TW_Armour_Leather' for l in lines))
yes('L3 a piece no recipe makes, and one with no Armour header keyword, are not listed',
    not any(('NobodyMakes' in l or 'PlainShirt' in l) for l in lines if l.startswith('ARMO')))
yes('L4 the later master\'s copy of a record is the one read',
    not any(l.startswith('ARMO') and 'Patched' in l for l in lines) and any(l.strip() == '2 $TW_Armour_Iron' for l in lines))
yes('L5 a piece two groups claim is named',
    '1 pieces two groups both claim' in out and any('Twice' in l and '$TW_Armour_Iron, $TW_Armour_Leather' in l for l in lines))
if failed:
    print(out + run.stderr)

print('')
print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
