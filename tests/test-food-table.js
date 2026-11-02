// test-food-table.js
//
// Mead, ale and wine fill thirst, not hunger.
//
// Djinn on dev, 24 September, in a thread called Thirst stat: "if any drink
// is supposed to satiate your thirst, any alcohol doesn't do this at all",
// with a screenshot of Thirst 0%, Hunger 100% and "You have eaten enough".
//
// Measured from the code: the food table held a line for every VERSION of a
// record, keyed by the plugin each version was read out of. Ale was
// 34c5e:Skyrim.esm reading food, 34c5e:Update.esm reading food and
// 34c5e:Gourmet.esp reading ale. An override keeps the form id of the plugin
// that made the record, so the game reports that ale as 34c5e of Skyrim.esm,
// the server found the food line and the drink filled hunger. The Gourmet
// line could never be found at all.
//
// Two halves.
//
//   A. The builder itself, scripts/dev/Build-FoodTable.js, run on plugins this
//      harness writes, so it runs on any machine: one line per record, keyed
//      by the plugin that made it, worth what the last plugin says.
//
//   B. The table that ships, the FOODS line in game/gamemode.js, through the
//      REAL lookup in the needs block, with the form ids the game reports for
//      Nord Mead, Honningbrew Mead, Alto Wine, Ale and Black-Briar Mead.
//
// Read only. The builder runs on a copy in a temporary folder and writes only
// there.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = REPO_DIR;
const SRC = process.env.GM || path.join(REPO, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------------ A --

/*
  A plugin, written out byte by byte in the shape the builder reads: a TES4
  header with its MAST list, then one ALCH group. A number for a name is a
  localised plugin's strings file id, which is what Skyrim.esm really carries
  and why its own lines never matched a drink word.
*/
function zs(s) { return Buffer.concat([Buffer.from(s, 'latin1'), Buffer.alloc(1)]); }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function sub(tag, data) {
  const h = Buffer.alloc(6);
  h.write(tag, 0, 'ascii');
  h.writeUInt16LE(data.length, 4);
  return Buffer.concat([h, data]);
}
function record(type, formId, flags, data) {
  const h = Buffer.alloc(24);
  h.write(type, 0, 'ascii');
  h.writeUInt32LE(data.length, 4);
  h.writeUInt32LE(flags >>> 0, 8);
  h.writeUInt32LE(formId >>> 0, 12);
  return Buffer.concat([h, data]);
}
function group(label, recs) {
  const body = Buffer.concat(recs);
  const h = Buffer.alloc(24);
  h.write('GRUP', 0, 'ascii');
  h.writeUInt32LE(24 + body.length, 4);
  h.write(label, 8, 'ascii');
  return Buffer.concat([h, body]);
}
function alch(formId, edid, name, food) {
  const enit = Buffer.alloc(20);
  enit.writeUInt32LE(5, 0);
  enit.writeUInt32LE(food ? 2 : 0, 4);
  return record('ALCH', formId, 0, Buffer.concat([
    sub('EDID', zs(edid)),
    sub('FULL', typeof name === 'number' ? u32(name) : zs(name)),
    sub('ENIT', enit)
  ]));
}
function plugin(headerFlags, masters, recs) {
  const hedr = Buffer.alloc(12);
  hedr.writeFloatLE(1.71, 0);
  hedr.writeUInt32LE(recs.length, 4);
  hedr.writeUInt32LE(0x800, 8);
  const parts = [sub('HEDR', hedr)];
  masters.forEach(function (m) {
    parts.push(sub('MAST', zs(m)));
    parts.push(sub('DATA', Buffer.alloc(8)));
  });
  return Buffer.concat([record('TES4', 0, headerFlags, Buffer.concat(parts)), group('ALCH', recs)]);
}

const FIVE = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-food-'));
const DATA = path.join(TMP, 'Game', 'Data');
fs.mkdirSync(DATA, { recursive: true });
// The gamemode and its tables sit in game\ since phase 6 (issue #440).
fs.mkdirSync(path.join(TMP, 'game', 'data'), { recursive: true });
// And the table builders in scripts\dev since phase 8.
fs.mkdirSync(path.join(TMP, 'scripts', 'dev'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'Profile', 'Default'), { recursive: true });

/*
  The same shape as this build, measured 24 September: Skyrim.esm makes the
  drinks with names that are strings file numbers, Update.esm overrides some
  of them the same way, and Gourmet.esp (light, five masters) overrides them
  with real names and adds drinks of its own. LowerCase.esp writes its master
  as "skyrim.esm", which a plugin is allowed to do and the server's exact
  file match is not.
*/
fs.writeFileSync(path.join(DATA, 'Skyrim.esm'), plugin(0x81, [], [
  alch(0x00034c5e, 'Ale', 0x25a6, true),
  alch(0x00034c5d, 'FoodMead', 0xe9a2, true),
  alch(0x0003133b, 'FoodWineAlto', 0x8844, true),
  alch(0x000508ca, 'FoodHonningbrewMead', 0xca9c, true),
  alch(0x0002c35a, 'FoodBlackBriarMead', 0xb83e, true),
  alch(0x00064b3d, 'FoodSweetroll', 0x9690, true),
  alch(0x00064b41, 'FoodPotato', 0xfa5f, true),
  alch(0x00065c37, 'RiftenSpecial01', 0x46e4, false),
  alch(0x0003eadd, 'RestoreHealth01', 0x1234, false)
]));
fs.writeFileSync(path.join(DATA, 'Update.esm'), plugin(0x81, ['Skyrim.esm'], [
  alch(0x00034c5e, 'Ale', 0x25a6, true),
  alch(0x00065c37, 'RiftenSpecial01', 0x46e4, true)
]));
// The other three masters carry no food here, but a game folder holds them and
// the builder stops on a plugin of the load order that is not on disk (#2976).
for (const m of ['Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']) { fs.writeFileSync(path.join(DATA, m), plugin(0x81, ['Skyrim.esm'], [])); }
fs.writeFileSync(path.join(DATA, 'LowerCase.esp'), plugin(0, ['skyrim.esm'], [
  alch(0x00064b41, 'FoodPotato', 'Potato', true)
]));
fs.writeFileSync(path.join(DATA, 'Gourmet.esp'), plugin(0x200, FIVE, [
  alch(0x00034c5e, 'MAG_DrinkAle', 'Ale', true),
  alch(0x00034c5d, 'MAG_DrinkMead', 'Mead', true),
  alch(0x0003133b, 'MAG_DrinkWineAlto', 'Alto Wine', true),
  alch(0x000508ca, 'MAG_DrinkHonningbrewMead', 'Honningbrew Mead', true),
  alch(0x0002c35a, 'MAG_DrinkBlackBriarMead', 'Black-Briar Mead', true),
  alch(0x00064b3d, 'MAG_FoodSweetroll', 'Sweet Roll', true),
  alch(0x00065c37, 'MAG_DrinkRiftenSpecial01', 'Velvet LeChance', true),
  alch(0x040207e5, 'MAG_DrinkFlin', 'Flin', true),
  alch(0x05000919, 'MAG_DrinkHonningbrewMeadLimited', 'Honningbrew Limited', true)
]));
fs.writeFileSync(path.join(TMP, 'Profile', 'Default', 'plugins.txt'),
  ['*LowerCase.esp', '*Gourmet.esp', ''].join(String.fromCharCode(13, 10)));
fs.copyFileSync(path.join(REPO, 'scripts', 'dev', 'Build-FoodTable.js'), path.join(TMP, 'scripts', 'dev', 'Build-FoodTable.js'));
fs.copyFileSync(path.join(REPO, 'scripts', 'dev', 'OwnPlugins.js'), path.join(TMP, 'scripts', 'dev', 'OwnPlugins.js'));
fs.copyFileSync(path.join(REPO, 'scripts', 'dev', 'GamemodeTables.js'), path.join(TMP, 'scripts', 'dev', 'GamemodeTables.js'));
// The table the gamemode reads is its own file since #5191.
const TABLE = path.join(TMP, 'game', 'gamemode-tables', 'FOODS.json');

function build() {
  return spawnSync(process.execPath, [path.join(TMP, 'scripts', 'dev', 'Build-FoodTable.js'), '--data', DATA],
                   { encoding: 'utf8' });
}
function installed() {
  try { return JSON.parse(fs.readFileSync(TABLE, 'utf8')).items; } catch (e) { return null; }
}

const run1 = build();
if (run1.status !== 0) { console.log(run1.stdout + run1.stderr); }
yes('A1 the builder runs on a load order of seven plugins and exits 0', run1.status === 0);
const got = installed() || {};
const built = (function () {
  try { return JSON.parse(fs.readFileSync(path.join(TMP, 'game', 'data', 'food.json'), 'utf8')).items; }
  catch (e) { return {}; }
})();
function linesFor(local) {
  return Object.keys(got).filter(function (d) { return d.split(':')[0] === local; });
}

{
  const ale = linesFor('34c5e');
  yes('A2 Ale is one line, not one per plugin that carries it (' + ale.join(', ') + ')',
      ale.length === 1 && ale[0] === '34c5e:Skyrim.esm');
  yes('A2 and nothing is keyed by a plugin that only overrides it',
      !Object.keys(got).some(function (d) { return /^(34c5e|34c5d|3133b|508ca|2c35a|64b3d|65c37):(Update\.esm|Gourmet\.esp)$/.test(d); }));
}
{
  const want = { '34c5e': 'Ale', '34c5d': 'Nord Mead', '3133b': 'Alto Wine',
                 '508ca': 'Honningbrew Mead', '2c35a': 'Black-Briar Mead' };
  Object.keys(want).forEach(function (local) {
    const row = got[local + ':Skyrim.esm'];
    yes('A3 ' + want[local] + ' reads ale, which is the last plugin\'s answer',
        !!row && row.k === 'ale');
  });
}
yes('A3 food.json says the answer came from Gourmet.esp',
    !!built['34c5e:Skyrim.esm'] && built['34c5e:Skyrim.esm'].from === 'Gourmet.esp');
yes('A4 a sweet roll is still food', !!got['64b3d:Skyrim.esm'] && got['64b3d:Skyrim.esm'].k === 'food');
yes('A4 and a potion of healing is still a potion, under the plugin that made it',
    !!got['3eadd:Skyrim.esm'] && got['3eadd:Skyrim.esm'].k === 'potion');
yes('A5 a drink with no drink word in its name is a drink by its editor id (Velvet LeChance)',
    !!got['65c37:Skyrim.esm'] && got['65c37:Skyrim.esm'].k === 'drink');
yes('A6 a record Gourmet.esp made itself is keyed Gourmet.esp (919, Honningbrew Limited, ale)',
    !!got['919:Gourmet.esp'] && got['919:Gourmet.esp'].k === 'ale');
yes('A6 an override of the fifth master lands on Dragonborn.esm (Flin, ale)',
    !!got['207e5:Dragonborn.esm'] && got['207e5:Dragonborn.esm'].k === 'ale');
yes('A7 a master written "skyrim.esm" lands on the load order\'s spelling',
    linesFor('64b41').join(',') === '64b41:Skyrim.esm');
yes('A8 twenty one versions of eleven records make eleven lines (' + Object.keys(got).length + ')',
    Object.keys(got).length === 11);

/*
  The block is generated, and generating it twice is the proof: the same load
  order gives the same line, and the builder says so instead of saying FAIL,
  which is what it did before 24 September whenever nothing had changed.
*/
{
  const before = fs.readFileSync(TABLE, 'utf8');
  const run2 = build();
  const after = fs.readFileSync(TABLE, 'utf8');
  yes('A9 run again on the same plugins, it exits 0 and leaves the same table',
      run2.status === 0 && before === after);
}

/*
  --plugins <file> (#1140). Same flag as the warmth / water / fire / weather
  builders. Without Gourmet.esp the drink words never land, so Ale reads food.
*/
{
  const alt = path.join(TMP, 'elsewhere', 'plugins.txt');
  fs.mkdirSync(path.dirname(alt), { recursive: true });
  fs.writeFileSync(alt, ['*LowerCase.esp', ''].join(String.fromCharCode(13, 10)));
  fs.rmSync(TABLE, { force: true });
  const runAlt = spawnSync(process.execPath,
    [path.join(TMP, 'scripts', 'dev', 'Build-FoodTable.js'), '--data', DATA, '--plugins', alt],
    { encoding: 'utf8' });
  if (runAlt.status !== 0) { console.log(runAlt.stdout + runAlt.stderr); }
  yes('A10 --plugins reads an alternate list and exits 0', runAlt.status === 0);
  const gotAlt = installed() || {};
  yes('A10 without Gourmet.esp, Ale reads food (Skyrim.esm name is a strings id)',
      !!gotAlt['34c5e:Skyrim.esm'] && gotAlt['34c5e:Skyrim.esm'].k === 'food');
  yes('A10 Gourmet-only drinks are absent (919 Honningbrew Limited)',
      !gotAlt['919:Gourmet.esp']);
  yes('A10 LowerCase.esp still lands the potato on Skyrim.esm',
      !!gotAlt['64b41:Skyrim.esm'] && gotAlt['64b41:Skyrim.esm'].k === 'food');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }

// ------------------------------------------------------------------ B --

const FOODS = (function () {
  const m = require('./gamemode-tables.js').lineOf(src, 'FOODS');
  try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; }
})();
yes('B0 the FOODS line is in the gamemode and parses', !!(FOODS && FOODS.items));
const items = (FOODS && FOODS.items) || {};

/*
  THE SERVER'S LOAD ORDER, as far as a descriptor cares: the five masters,
  then every other plugin the table names. FormDesc::ToFormId in the fork
  turns "34c5e:Skyrim.esm" into index * 0x01000000 + 0x34c5e with an exact
  file match and throws on a file it does not have, and mp.getIdFromDesc is
  that, so this is that. The ids that matter here are Skyrim.esm's, which are
  the same in every load order.
*/
const LOAD = FIVE.slice();
Object.keys(items).forEach(function (d) {
  const f = d.slice(d.indexOf(':') + 1);
  if (LOAD.indexOf(f) === -1) { LOAD.push(f); }
});
function getIdFromDesc(desc) {
  const at = desc.indexOf(':');
  const file = desc.slice(at + 1);
  const idx = LOAD.indexOf(file);
  if (idx === -1) { throw new Error(file + ' not found in loaded files'); }
  return idx * 0x01000000 + parseInt(desc.slice(0, at), 16);
}

// The real idOf, out of the gamemode, and the real needs block.
const idOfSrc = (function () {
  const m = /^function idOf\(descriptor\) \{[^]*?^\}$/m.exec(src);
  return m ? m[0] : null;
})();
yes('B0 idOf is in the gamemode', !!idOfSrc);

const A = '// ==== thornswood needs: hunger, thirst and exhaustion ====';
const B = '// ==== end thornswood needs ====';
const a = src.indexOf(A);
const b = a < 0 ? -1 : src.indexOf(B, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
yes('B0 the needs block is in the gamemode', block !== null);

function rig() {
  const store = {};
  const clock = { now: 1000000000000 };
  const g = {};
  const Fake = {
    makeProperty: function () { },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return Object.keys(store).map(Number); }
      if (key === 'worldOrCellDesc') { return 'cell:X.esm'; }
      return store[id] ? store[id].v : undefined;
    },
    set: function (id, key, v) {
      if (!store[id]) { store[id] = {}; }
      store[id].v = v;
    },
    getIdFromDesc: getIdFromDesc
  };
  const fn = new Function(
    'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'FOODS',
    idOfSrc + '\n' + block + '\nreturn globalThis.__thornswoodNeeds;');
  const api = fn(
    g, Fake, { now: function () { return clock.now; } }, { log: function () { } },
    function () { return 0; }, function () { },
    function (n, f) { return f; }, function () { }, function () { }, FOODS);
  api.clock = clock;
  api.seed = function (id) { Fake.set(id, 'x', api.fresh()); };
  return api;
}

if (block !== null && idOfSrc && FOODS) {
  const HOUR = 3600000;
  const ME = 0xff000001;

  /*
    WHAT THE GAME REPORTS. The client's equip handler sends
    e.baseObj.getFormID(), and an override does not move a record, so each of
    these is the Skyrim.esm id whatever Gourmet.esp did to it. The names are
    vanilla's; Gourmet renames Nord Mead to Mead.
  */
  const DRINKS = [
    ['Nord Mead', 0x34c5d],
    ['Honningbrew Mead', 0x508ca],
    ['Alto Wine', 0x3133b],
    ['Ale', 0x34c5e],
    ['Black-Briar Mead', 0x2c35a]
  ];
  DRINKS.forEach(function (row) {
    const name = row[0], id = row[1];
    const local = id.toString(16);
    const lines = Object.keys(items).filter(function (d) { return d.split(':')[0] === local; });
    yes('B1 ' + name + ' is one line in the table (' + lines.join(', ') + ')',
        lines.length === 1 && lines[0] === local + ':Skyrim.esm');

    const r = rig();
    r.seed(ME);
    r.clock.now += 2 * HOUR;       // a bit thirsty and a bit hungry, so both can move
    const was = r.settle(ME);
    const food0 = was.food, drink0 = was.drink;
    const said = r.consumed(ME, id);
    const now = r.settle(ME);
    yes('B2 ' + name + ' (' + local + ') fills thirst: ' + drink0.toFixed(1) + ' to ' + now.drink.toFixed(1),
        now.drink > drink0);
    yes('B2 ' + name + ' does not fill hunger: ' + food0.toFixed(1) + ' to ' + now.food.toFixed(1),
        now.food <= food0);
    yes('B2 ' + name + ' goes down as ale, the first of the night',
        typeof said === 'string' && said.indexOf('You drink it down.') === 0);
  });

  // And a meal is still a meal, so the checks above cannot pass by
  // everything having become a drink.
  {
    const r = rig();
    r.seed(ME);
    r.clock.now += 2 * HOUR;
    const was = r.settle(ME);
    const food0 = was.food, drink0 = was.drink;
    r.consumed(ME, 0x64b3d);
    const now = r.settle(ME);
    yes('B3 a Sweet Roll (64b3d) fills hunger and not thirst',
        now.food > food0 && now.drink <= drink0);
  }

  /*
    A POTION SOMEBODY BREWED. The alchemy lab makes the record, so its id is
    above 0xff000000 and in no plugin, and the food table cannot have it. It
    fell through to food until 25 September. It is a potion: a mouthful
    towards thirst, NEEDS.potion, and not a meal.
  */
  {
    const r = rig();
    r.seed(ME);
    r.clock.now += 2 * HOUR;
    const was = r.settle(ME);
    const food0 = was.food, drink0 = was.drink;
    r.consumed(ME, 0xff000812);
    const now = r.settle(ME);
    yes('B3b a brewed potion (ff000812) goes towards thirst: ' + drink0.toFixed(1) + ' to ' + now.drink.toFixed(1),
        now.drink > drink0);
    yes('B3b and is not a meal: ' + food0.toFixed(1) + ' to ' + now.food.toFixed(1),
        now.food <= food0);
    yes('B3b and is a mouthful, less than a drink of water would be',
        now.drink - drink0 < 20);
  }

  /*
    EVERY VANILLA DRINK GOURMET TAKES OVER. Gourmet calls each drink it
    touches MAG_Drink..., and food.json says whose version each line was read
    from. On 24 September that is 27 records, and before this change every one
    of them was either food or a potion at the id the game reports.
  */
  let food = null;
  try { food = JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'food.json'), 'utf8')); } catch (e) { food = null; }
  const rows = (food && food.items) || {};
  const taken = Object.keys(rows).filter(function (d) {
    const r = rows[d];
    return r.from === 'Gourmet.esp' && r.file !== 'Gourmet.esp' && /^MAG_Drink/.test(r.edid || '');
  });
  const wrong = taken.filter(function (d) {
    return !items[d] || (items[d].k !== 'ale' && items[d].k !== 'drink');
  });
  yes('B4 food.json names the vanilla drinks Gourmet.esp overrides (' + taken.length + ')',
      taken.length > 0);
  yes('B4 and every one of them reads ale or drink' +
      (wrong.length ? ': not ' + wrong.join(', ') : ''), taken.length > 0 && wrong.length === 0);

  // The installed line is food.json's, and nothing else.
  const fk = Object.keys(rows);
  yes('B5 the FOODS line and food.json hold the same records, ' + Object.keys(items).length + ' of them',
      fk.length === Object.keys(items).length &&
      fk.every(function (d) { return items[d] && items[d].k === rows[d].kind; }));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
