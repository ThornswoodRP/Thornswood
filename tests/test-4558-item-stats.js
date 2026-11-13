// test-4558-item-stats.js
//
// scripts/dev/Build-ItemStats.js reads what each item the item source table
// names is, off the records: armour rating, type, slots and keywords; weapon
// damage, type, speed, reach and keywords; ammunition damage; and the weight
// of anything.
//
// WHY. Issue #4558. Crafted goods are weighed against race, company, faction
// and quest items by what they take to make or get and by their stats, never
// gold (decided 22 Oct), and no table held the stats. This builds a load order
// of small plugins in a temporary folder and holds the builder to what is in
// them:
//   an armour's rating, type, slots and keywords (by KYWD editor id);
//   a weapon's damage, type, speed, reach and weight;
//   ammunition's damage, and a misc item's weight;
//   a compressed record read the same as a plain one;
//   an override in a later plugin wins, under the form id of the plugin that
//     made the record;
//   an item the source table does not name is not written, and one it names
//     that no plugin has is listed as not found;
//   one of Update.esm's Creation Club records is left out (#479);
//   no value is written anywhere.
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
function kwda(ids) { return [sub('KSIZ', u32(ids.length)), sub('KWDA', Buffer.concat(ids.map(u32)))]; }
function kywd(id, edid) { return record('KYWD', id, [sub('EDID', zstr(edid))]); }
function armo(id, edid, rating100, weight, slots, armourType, keywords, compressed) {
  const data = Buffer.alloc(8); data.writeInt32LE(999, 0); data.writeFloatLE(weight, 4);
  const dnam = Buffer.alloc(4); dnam.writeInt32LE(rating100, 0);
  const bod2 = Buffer.alloc(8); bod2.writeUInt32LE(slots, 0); bod2.writeUInt32LE(armourType, 4);
  return record('ARMO', id, [sub('EDID', zstr(edid)), sub('BOD2', bod2)].concat(kwda(keywords), [sub('DATA', data), sub('DNAM', dnam)]), compressed);
}
function weap(id, edid, damage, weight, wtype, speed, reach, keywords) {
  const data = Buffer.alloc(10); data.writeUInt32LE(777, 0); data.writeFloatLE(weight, 4); data.writeUInt16LE(damage, 8);
  const dnam = Buffer.alloc(100); dnam.writeUInt8(wtype, 0); dnam.writeFloatLE(speed, 4); dnam.writeFloatLE(reach, 8);
  return record('WEAP', id, [sub('EDID', zstr(edid))].concat(kwda(keywords), [sub('DATA', data), sub('DNAM', dnam)]));
}
function ammo(id, edid, damage, weight) {
  const data = Buffer.alloc(20); data.writeFloatLE(damage, 8); data.writeUInt32LE(5, 12); data.writeFloatLE(weight, 16);
  return record('AMMO', id, [sub('EDID', zstr(edid)), sub('DATA', data)]);
}
function misc(id, edid, weight) {
  const data = Buffer.alloc(8); data.writeUInt32LE(3, 0); data.writeFloatLE(weight, 4);
  return record('MISC', id, [sub('EDID', zstr(edid)), sub('DATA', data)]);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-4558-'));
try {
  const DATA = path.join(TMP, 'Data');
  fs.mkdirSync(DATA);
  fs.writeFileSync(path.join(DATA, 'Skyrim.esm'), plugin([], [
    grup('KYWD', [kywd(0x6bbe8, 'ArmorHeavy'), kywd(0x6c0ec, 'ArmorCuirass'), kywd(0x1e711, 'WeapTypeSword')]),
    grup('ARMO', [armo(0x12e49, 'ArmorIronCuirass', 2500, 30, 0x4, 1, [0x6bbe8, 0x6c0ec], true),
                  armo(0x13911, 'ArmorSteelCuirassA', 3100, 35, 0x4, 1, [0x6bbe8, 0x6c0ec, 0x00abcdef], false),
                  armo(0x99999, 'ArmorNobodyAsked', 100, 1, 0x4, 0, [], false)]),
    grup('WEAP', [weap(0x12eb7, 'IronSword', 7, 9, 1, 1, 1, [0x1e711])]),
    grup('AMMO', [ammo(0x1397d, 'IronArrow', 8, 0)]),
    grup('MISC', [misc(0x5ace4, 'IngotIron', 1)])
  ]));
  fs.writeFileSync(path.join(DATA, 'Update.esm'), plugin(['Skyrim.esm'], [
    grup('MISC', [misc(0x0100306d, 'ccBGS_SomethingCreation', 2)])
  ]));
  for (const m of ['Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']) {
    fs.writeFileSync(path.join(DATA, m), plugin(['Skyrim.esm'], []));
  }
  // A mod that makes the steel cuirass light at 28.
  fs.writeFileSync(path.join(DATA, 'Mod.esp'), plugin(['Skyrim.esm'], [
    grup('ARMO', [armo(0x00013911, 'ArmorSteelCuirassA', 2800, 20, 0x4, 0, [0x6c0ec], false)])
  ]));
  const PLUGINS = path.join(TMP, 'plugins.txt');
  fs.writeFileSync(PLUGINS, '*Mod.esp\n');
  const SOURCES = path.join(TMP, 'item-sources.json');
  const named = ['12e49:Skyrim.esm', '13911:Skyrim.esm', '12eb7:Skyrim.esm', '1397d:Skyrim.esm', '5ace4:Skyrim.esm',
                 '306d:Update.esm', '4242:Nowhere.esp'];
  const items = {};
  for (const d of named) { items[d] = { name: d, sources: [] }; }
  fs.writeFileSync(SOURCES, JSON.stringify({ items: items }));
  const OUT = path.join(TMP, 'item-stats.json');

  const p = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dev', 'Build-ItemStats.js'),
    '--data', DATA, '--plugins', PLUGINS, '--sources', SOURCES, '--out', OUT], { encoding: 'utf8' });
  if (p.status !== 0) { console.log(p.stdout + p.stderr); }
  yes('the builder runs on a load order of six plugins', p.status === 0 && fs.existsSync(OUT));
  const t = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { items: {}, notFound: [] };
  const i = t.items;
  const iron = i['12e49:Skyrim.esm'] || {};
  yes('an armour carries its rating, type, slots and weight (and a compressed record reads the same)',
    iron.type === 'ARMO' && iron.rating === 25 && iron.armourType === 'heavy' && iron.slots === 4 && iron.weight === 30);
  yes('an armour\'s keywords are written by editor id',
    JSON.stringify(iron.keywords) === JSON.stringify(['ArmorHeavy', 'ArmorCuirass']));
  const steel = i['13911:Skyrim.esm'] || {};
  yes('the later plugin\'s version wins, under the form id of the plugin that made it',
    steel.from === 'Mod.esp' && steel.rating === 28 && steel.armourType === 'light' && steel.weight === 20 &&
    !Object.keys(i).some((d) => /Mod\.esp$/.test(d)));
  const sword = i['12eb7:Skyrim.esm'] || {};
  yes('a weapon carries its damage, type, speed, reach, weight and keywords',
    sword.type === 'WEAP' && sword.damage === 7 && sword.weaponType === 'one-handed sword' && sword.speed === 1 &&
    sword.reach === 1 && sword.weight === 9 && JSON.stringify(sword.keywords) === JSON.stringify(['WeapTypeSword']));
  yes('ammunition carries its damage', (i['1397d:Skyrim.esm'] || {}).damage === 8);
  yes('a misc item carries its weight', (i['5ace4:Skyrim.esm'] || {}).weight === 1);
  yes('an item the source table does not name is not written', !i['99999:Skyrim.esm']);
  yes('an item the table names that no plugin has is listed as not found',
    Array.isArray(t.notFound) && t.notFound.indexOf('4242:Nowhere.esp') >= 0);
  yes('Update.esm\'s Creation Club record is left out, and said',
    !i['306d:Update.esm'] && /1 of them Update\.esm's Creation Club records, left out/.test(p.stdout));
  yes('no value is written anywhere', !/"value"|999|777/.test(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : 'value'));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
