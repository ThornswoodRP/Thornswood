// test-3470-ingredient-table.js
//
// scripts/dev/Build-IngredientTable.js reads which alchemy effects each
// ingredient, potion and poison carries off the plugins, by the magic
// effect's editor id.
//
// WHY. Issue #3470. A Physicker's bench recipe for a potion must ask for
// ingredients that really carry its effect, and the repository had no table
// of which ingredient carries which effect (docs/systems/professions/
// alchemist.md). This builds a load order of small plugins in a temporary
// folder and holds the builder to what is in them:
//   an ingredient's effects, in record order, named by the MGEF's editor id;
//   a compressed record read the same as a plain one;
//   an override in a later plugin wins, under the form id of the plugin that
//     made the record (its MAST list read, not its own file name);
//   a potion and a poison are kept with their kind, and a food item is not;
//   an effect no plugin defines is kept as its desc and counted, never
//     dropped.
//   one of Update.esm's Creation Club records (records/update-creation-club.json)
//     is left out, so no recipe can ask for it (#479).
//
// Nothing outside the temporary folder is written.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

function sub(type, data) {
  const h = Buffer.alloc(6);
  h.write(type, 0, 'ascii');
  h.writeUInt16LE(data.length, 4);
  return Buffer.concat([h, data]);
}
function zstr(s) { return Buffer.from(s + '\0', 'latin1'); }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function record(type, formId, subs, compressed) {
  let data = Buffer.concat(subs);
  let flags = 0;
  if (compressed) { data = Buffer.concat([u32(data.length), zlib.deflateSync(data)]); flags = 0x00040000; }
  const h = Buffer.alloc(24);
  h.write(type, 0, 'ascii');
  h.writeUInt32LE(data.length, 4);
  h.writeUInt32LE(flags, 8);
  h.writeUInt32LE(formId >>> 0, 12);
  return Buffer.concat([h, data]);
}
function grup(label, records) {
  const body = Buffer.concat(records);
  const h = Buffer.alloc(24);
  h.write('GRUP', 0, 'ascii');
  h.writeUInt32LE(24 + body.length, 4);
  h.write(label, 8, 'ascii');
  return Buffer.concat([h, body]);
}
function plugin(masters, groups) {
  const head = record('TES4', 0, [sub('HEDR', Buffer.alloc(12))].concat(
    [].concat.apply([], masters.map((m) => [sub('MAST', zstr(m)), sub('DATA', Buffer.alloc(8))]))));
  return Buffer.concat([head].concat(groups));
}
function effect(id) { return [sub('EFID', u32(id)), sub('EFIT', Buffer.alloc(12))]; }
function ingr(id, edid, effects, compressed) {
  return record('INGR', id, [sub('EDID', zstr(edid))].concat([].concat.apply([], effects.map(effect))), compressed);
}
function alch(id, edid, flags, effects) {
  const enit = Buffer.alloc(20);
  enit.writeUInt32LE(5, 0);
  enit.writeUInt32LE(flags, 4);
  return record('ALCH', id, [sub('EDID', zstr(edid)), sub('ENIT', enit)].concat([].concat.apply([], effects.map(effect))));
}
function mgef(id, edid) { return record('MGEF', id, [sub('EDID', zstr(edid))]); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-3470-'));
try {
  const DATA = path.join(TMP, 'Data');
  fs.mkdirSync(DATA);
  // Skyrim.esm: four effects, three ingredients (one compressed), a potion,
  // a poison and a meal.
  fs.writeFileSync(path.join(DATA, 'Skyrim.esm'), plugin([], [
    grup('MGEF', [mgef(0x3eb15, 'AlchRestoreHealth'), mgef(0x3eb16, 'AlchRestoreMagicka'),
                  mgef(0x3eb17, 'AlchRestoreStamina'), mgef(0x3eaf3, 'AlchDamageHealth')]),
    grup('INGR', [ingr(0x77e1c, 'MountainFlower01Blue', [0x3eb15, 0x3eaf3]),
                  ingr(0x4b0ba, 'Wheat', [0x3eb15, 0x3eb17], true),
                  ingr(0x77e1d, 'MountainFlower01Red', [0x3eb16])]),
    grup('ALCH', [alch(0x3eadd, 'RestoreHealth01', 0, [0x3eb15]),
                  alch(0x3eaf0, 'DamageHealth01', 0x00020000, [0x3eaf3]),
                  alch(0x65c98, 'FoodBread', 0x2, [0x3eb15])])
  ]));
  // Update.esm's own Creation Club root, 306d, which the list names.
  fs.writeFileSync(path.join(DATA, 'Update.esm'), plugin(['Skyrim.esm'], [
    grup('INGR', [ingr(0x0100306d, 'ccBGS_RootRotScaleIngredient', [0x3eb15])])
  ]));
  for (const m of ['Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']) {
    fs.writeFileSync(path.join(DATA, m), plugin(['Skyrim.esm'], []));
  }
  // A mod that changes the red flower (its high byte 00 is Skyrim.esm by its
  // MAST list) and names an effect nobody defines.
  fs.writeFileSync(path.join(DATA, 'Mod.esp'), plugin(['Skyrim.esm'], [
    grup('INGR', [ingr(0x00077e1d, 'MountainFlower01Red', [0x3eb16, 0x3eb17, 0x00abcdef])])
  ]));
  const PLUGINS = path.join(TMP, 'plugins.txt');
  fs.writeFileSync(PLUGINS, '*Mod.esp\n');
  const OUT = path.join(TMP, 'ingredients.json');

  const p = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dev', 'Build-IngredientTable.js'),
    '--data', DATA, '--plugins', PLUGINS, '--out', OUT], { encoding: 'utf8' });
  if (p.status !== 0) { console.log(p.stdout + p.stderr); }
  yes('the builder runs on a load order of six plugins', p.status === 0 && fs.existsSync(OUT));
  const t = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { ingredients: {}, potions: {} };
  const i = t.ingredients, q = t.potions;

  yes('an ingredient carries its effects in record order, by editor id',
    JSON.stringify((i['77e1c:Skyrim.esm'] || {}).effects) === JSON.stringify(['AlchRestoreHealth', 'AlchDamageHealth']));
  yes('a compressed record is read the same',
    JSON.stringify((i['4b0ba:Skyrim.esm'] || {}).effects) === JSON.stringify(['AlchRestoreHealth', 'AlchRestoreStamina']));
  yes('the later plugin\'s version wins, under the form id of the plugin that made it',
    !!i['77e1d:Skyrim.esm'] && i['77e1d:Skyrim.esm'].from === 'Mod.esp' &&
    !Object.keys(i).some((d) => /Mod\.esp$/.test(d)));
  yes('an effect no plugin defines is kept as its desc',
    !!i['77e1d:Skyrim.esm'] && i['77e1d:Skyrim.esm'].effects[2] === 'abcdef:Skyrim.esm');
  yes('a potion and a poison are kept with their kind',
    (q['3eadd:Skyrim.esm'] || {}).kind === 'potion' && (q['3eaf0:Skyrim.esm'] || {}).kind === 'poison' &&
    JSON.stringify(q['3eadd:Skyrim.esm'].effects) === JSON.stringify(['AlchRestoreHealth']));
  yes('a meal is not a potion', !q['65c98:Skyrim.esm']);
  yes('Update.esm\'s Creation Club root is left out, and said',
    !i['306d:Update.esm'] && /1 of them Update\.esm's Creation Club records, left out/.test(p.stdout));
  yes('it says how many effects no plugin names', /1 effect\(s\) no plugin names/.test(p.stdout));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
