// test-2906-cook-quality.js
//
// #2906. Patrick, 20 October 2026, B: a cook comes out burnt, plain or fine,
// the odds by the cook's rank, and a fine dish's help lasts 30 real minutes
// instead of 20. Burnt is docs/systems/food.md's row: 8 hunger and stamina
// recovery -10% for 10 real minutes.
//
// Cause (issuecomment on #2906, 20 Oct): mp.onCraft could only allow or refuse
// a craft, so a cook's result could only be the recipe's own dish, and the
// only way to give a burnt one was to take the dish back out of the pack
// afterwards. The engine fork's craftOutput (fork #92) lets the handler name
// what the craft gives, and the content plugin carries a Burnt Meal and a fine
// record of every dish (Add-ContentRecords.py, food-groups.json's quality).
//
// It checks, without the game:
//   1. the table: every dish the Cook makes at the pot and the oven has one
//      fine record, in its plain dish's group, and there is one burnt meal;
//   2. the real needs block: the roll by rank, and what each one does eaten;
//   3. the real cookedOutput out of mp.onCraft over a stand-in engine: it
//      names the record and the count, Grand Chef's batch is two of the one
//      quality, and nothing waits for the engine;
//   4. the committed content plugin holds every record the table names;
//   5. Add-ContentRecords.py, over stand-in masters, makes each record from
//      its plain dish's look, and stops on a dish whose look names a plugin
//      the content plugin does not master.
//
// Copies go to a temporary folder (TEST_TMP if set) and are removed. Read only.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, fn) {
  try { fn(); } catch (e) { fail++; console.log('FAIL  ' + what + ' threw: ' + (e && e.stack ? e.stack : e)); }
}
function table(name) {
  const m = new RegExp('^const ' + name + ' = (\\{.*\\});$', 'm').exec(gm);
  return m ? JSON.parse(m[1]) : null;
}
function cut(head) {
  const a = gm.indexOf(head);
  const b = a < 0 ? -1 : gm.indexOf('\n}\n', a);
  return (a >= 0 && b > a) ? gm.slice(a, b + 3) : null;
}

const GROUPS = table('FOOD_GROUPS');
const FOODS = table('FOODS');
const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'food-groups.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'recipes.json'), 'utf8')).recipes;
const Q = (GROUPS && GROUPS.quality) || {};
const FINE = Q.fine || {};

// ------------------------------------------------------------ 1. the table --
yes('1 the gamemode\'s FOOD_GROUPS is game/data/food-groups.json exactly', JSON.stringify(GROUPS) === JSON.stringify(file));
const dishes = {};
for (const k in recipes) {
  const r = recipes[k];
  if (r.owner !== 'Cook' || (r.benchName !== 'CraftingCookpot' && r.benchName !== 'BYOHCraftingOven')) { continue; }
  const g = GROUPS.items[r.out];
  // A festival feast (#3152) is a dish as well.
  if (g === 'cooked' || g === 'soup' || g === 'feast') { dishes[r.out] = r.name; }
}
yes('1 every dish the Cook makes at the pot and the oven has a fine record (' + Object.keys(dishes).length + ')',
  Object.keys(dishes).length === 67 && Object.keys(dishes).every(function (d) { return !!FINE[d]; }));
yes('1 and nothing else has one', Object.keys(FINE).every(function (d) { return !!dishes[d]; }));
const fineIds = Object.values(FINE);
yes('1 each fine record is the content plugin\'s own, one record each',
  new Set(fineIds).size === fineIds.length && fineIds.every(function (d) { return /^[0-9a-f]+:Thornswood-Content\.esp$/.test(d); }));
yes('1 each is in its plain dish\'s group', Object.keys(FINE).every(function (d) { return GROUPS.items[FINE[d]] === GROUPS.items[d]; }));
yes('1 one burnt meal, the content plugin\'s, in no group', /^[0-9a-f]+:Thornswood-Content\.esp$/.test(String(Q.burnt)) &&
  !GROUPS.items[Q.burnt] && fineIds.indexOf(Q.burnt) === -1);
yes('1 a tea and the mill\'s flour have no fine record',
  !FINE['18001:Thornswood-Content.esp'] && !FINE['3538:HearthFires.esm']);

// ------------------------------------------------------ 2. the needs block --
const a = gm.indexOf('// ==== thornswood needs: hunger, thirst and exhaustion ====');
const b = gm.indexOf('// ==== end thornswood needs ====');
const needsBlock = (a >= 0 && b > a) ? gm.slice(a, b) : null;
yes('2 the needs block is in the gamemode', !!needsBlock);
yes('2 the odds are the #2906 plan\'s, and fine lasts 30 minutes, burnt is 8 hunger and -10% stamina for 10',
  /cookQuality: \{\s*odds: \{\s*novice: \{ burnt: 0\.2, fine: 0\.05 \},\s*advanced: \{ burnt: 0\.1, fine: 0\.1 \},\s*expert: \{ burnt: 0\.05, fine: 0\.2 \},\s*master: \{ burnt: 0, fine: 0\.35 \}\s*\},\s*fineMinutes: 30,\s*burnt: \{ food: 8, stamina: -10, minutes: 10 \},/.test(gm));

const ids = {}; let next = 0x100;
[FOODS, GROUPS].forEach(function (t) { if (t) { for (const d in t.items) { if (!ids[d]) { ids[d] = next++; } } } });
if (Q.burnt && !ids[Q.burnt]) { ids[Q.burnt] = next++; }
function idOf(d) { return ids[d] || 0; }

function rig() {
  const store = {}, calls = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return []; } if (key === 'worldOrCellDesc' || key === 'pos') { return null; } return store[id]; },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  };
  const hurt = {
    exposed: function () { return false; },
    guarded: function (id, feast, minutes) { calls.push(['guarded', id, feast, minutes]); return true; },
    unguarded: function (id) { calls.push(['unguarded', id]); return true; }
  };
  const g = { __thornswoodHurt: hurt };
  const N = new Function('globalThis', 'mp', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', 'FOODS', 'FOOD_GROUPS', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, { log: function () { } }, function () { return 0; }, function () { },
    function (n, f) { return f; }, function () { }, function () { }, idOf, FOODS, GROUPS);
  return { N: N, store: store, calls: calls };
}

const STEW = 'f431d:Skyrim.esm', CHOP = '722bd:Skyrim.esm', TEA = '18001:Thornswood-Content.esp';
let N = null, R = null;
attempt('2 the needs block runs', function () { R = rig(); N = R.N; });
if (N && typeof N.cookedAs === 'function') {
  attempt('2 the roll', function () {
    const stew = idOf(STEW), fine = idOf(FINE[STEW]), burnt = idOf(Q.burnt);
    const at = function (rank, roll) { return N.cookedAs(stew, rank, roll); };
    yes('2 a novice burns a stew on a roll under 0.2', at('novice', 0.19).baseId === burnt && at('novice', 0.19).quality === 'burnt');
    yes('2 makes it fine from 0.2 to under 0.25', at('novice', 0.2).baseId === fine && at('novice', 0.249).quality === 'fine');
    yes('2 and plain above that', at('novice', 0.25).baseId === stew && at('novice', 0.99).quality === 'plain');
    yes('2 an advanced cook: burnt under 0.1, fine under 0.2', at('advanced', 0.09).quality === 'burnt' &&
      at('advanced', 0.1).quality === 'fine' && at('advanced', 0.2).quality === 'plain');
    yes('2 an expert: burnt under 0.05, fine under 0.25', at('expert', 0.04).quality === 'burnt' &&
      at('expert', 0.05).quality === 'fine' && at('expert', 0.25).quality === 'plain');
    yes('2 a master never burns it, and makes it fine under 0.35', at('master', 0).quality === 'fine' &&
      at('master', 0.349).quality === 'fine' && at('master', 0.35).quality === 'plain');
    yes('2 a tea comes out as it is, whatever the roll', N.cookedAs(idOf(TEA), 'novice', 0).baseId === idOf(TEA));
    yes('2 the needs block names the records', N.fineOf(stew) === fine && N.isFine(fine) && !N.isFine(stew) && N.burntMeal() === burnt);
  });
  let who = 1;
  function person(food) {
    const id = who++;
    const n = N.fresh(); n.at = Date.now(); n.food = (typeof food === 'number') ? food : 30; n.drink = 30; R.store[id] = n;
    return id;
  }
  attempt('2 a burnt meal eaten', function () {
    const id = person();
    const line = N.consumed(id, idOf(Q.burnt));
    const s = R.store[id];
    yes('2 a burnt meal is 8 hunger', Math.round(s.food - 30) === 8);
    yes('2 and stamina recovers 10% slower for 10 real minutes',
      Math.abs(s.burntUntil - (Date.now() + 10 * 60000)) < 5000 && N.effects(id, N.read(id)).staminaRateMult === -10);
    yes('2 and it says so', String(line).indexOf('It is burnt.') === 0);
    yes('2 it is not a meal\'s help and takes none away', !s.mealHelp && R.calls.every(function (c) { return c[1] !== id; }));
    const s2 = R.store[id]; s2.burntUntil = Date.now() - 1; R.store[id] = s2;
    yes('2 and when it is over stamina is as it was', !(N.effects(id, N.read(id)).staminaRateMult < 0));
    const full = person(95);
    N.consumed(full, idOf(Q.burnt));
    yes('2 a burnt meal on a full stomach slows nothing', !R.store[full].burntUntil);
  });
  attempt('2 a fine dish eaten', function () {
    const id = person();
    N.consumed(id, idOf(FINE[STEW]));
    const s = R.store[id];
    yes('2 a fine venison stew is what the stew is: 25 hunger and 10 thirst',
      Math.round(s.food - 30) === 25 && Math.round(s.drink - 30) === 10);
    yes('2 it warms, for 30 real minutes', s.mealHelp === 'warm' && Math.abs(s.mealHelpUntil - (Date.now() + 30 * 60000)) < 5000);
    const plain = person();
    N.consumed(plain, idOf(STEW));
    yes('2 the plain stew warms for 20', Math.abs(R.store[plain].mealHelpUntil - (Date.now() + 20 * 60000)) < 5000);
    yes('2 a fine dish loses its own magic like its plain dish', N.effectScale(1, idOf(FINE[CHOP])) === 0);
  });
} else {
  yes('2 the needs block answers cookedAs', false);
}
yes('2 a guard from a fine dish is told its 30 minutes (the injury block\'s guarded takes them)',
  /H\.guarded\(actorId, !!feast, lasts\)/.test(gm) &&
  /function guarded\(actorId, feast, minutes\) \{\s*var row = feast \? MEAL_GUARD\.feast : MEAL_GUARD\.cooked;\s*var lasts = Number\(minutes\) > 0 \? Number\(minutes\) : row\.min;/.test(gm));

// ------------------------------------------------- 3. cookedOutput, onCraft --
const pieces = [cut('function holdsPerk(actorId, key) {'), cut('function cookedOutput(actorId, row) {')];
yes('3 cookedOutput is in the gamemode, and mp.onCraft asks it once every gate has passed',
  pieces.every(Boolean) && /\n  cookedOutput\(actorId, row\);\n  qualityOutput\(actorId, row, margin\);\n  wovenOutput\(actorId, row\);\n  spoilingOutput\(actorId\);\n  return;\n\}\);/.test(gm));
function onCraftRig(state, perks, roll) {
  let output = null;
  const said = [];
  const mp = {
    get: function (a, key) { return key === 'craftOutput' && output ? Object.assign({}, output) : undefined; },
    set: function (a, key, v) { if (key === 'craftOutput' && output) { output = Object.assign({}, output, v); } }
  };
  const P = { perks: function () { return perks || []; }, rankOf: function (s, half) { return (s.ranks || {})[half] || null; } };
  const g = {
    __thornswoodProgression: P,
    __thornswoodCharacter: { stateOf: function () { return state; } },
    __thornswoodNeeds: N
  };
  const fn = new Function('mp', 'globalThis', 'log', 'notify', 'say', 'Math',
    pieces.join('\n') + '\nreturn cookedOutput;')(mp, g, function () { }, function () { },
    function (a, t) { said.push(t); }, { random: function () { return roll; } });
  return {
    said: said,
    craft: function (row, baseId, count) { output = { baseId: baseId, count: count }; fn(0xff000001, row); const o = output; output = null; return o; },
    none: function (row) { output = null; fn(0xff000001, row); return output; }
  };
}
if (N && pieces.every(Boolean)) {
  attempt('3 the craft', function () {
    const stewRow = { owner: 'Cook', half: 'Hearthcook', name: 'Venison Stew' };
    const novice = { prof: 'cook', ranks: { hearthcook: 'novice' } };
    const master = { prof: 'cook', ranks: { hearthcook: 'master' } };
    const stew = idOf(STEW), fine = idOf(FINE[STEW]), burnt = idOf(Q.burnt);
    const b1 = onCraftRig(novice, [], 0.1);
    const o1 = b1.craft(stewRow, stew, 1);
    yes('3 a novice\'s burnt stew: the craft gives the burnt meal, one', o1.baseId === burnt && o1.count === 1);
    yes('3 and the cook is told', b1.said.some(function (t) { return /Burnt Meal/.test(t); }));
    const o2 = onCraftRig(novice, [], 0.22).craft(stewRow, stew, 1);
    yes('3 a novice\'s fine stew: the fine record', o2.baseId === fine && o2.count === 1);
    const r3 = onCraftRig(novice, [], 0.9);
    const o3 = r3.craft(stewRow, stew, 1);
    yes('3 a plain stew is left as the recipe has it, and nothing is said', o3.baseId === stew && o3.count === 1 && r3.said.length === 0);
    const o4 = onCraftRig(master, ['grandchef'], 0.1).craft(stewRow, stew, 1);
    yes('3 a Grand Chef\'s batch is two of the one quality', o4.baseId === fine && o4.count === 2);
    const o5 = onCraftRig(master, ['grandchef'], 0.9).craft(stewRow, stew, 2);
    yes('3 and a batch of two plain comes out as four', o5.baseId === stew && o5.count === 4);
    const sister = { prof: 'cook', ranks: { confectioner: 'master', hearthcook: 'novice' } };
    yes('3 a master confectioner at the pot cooks a Hearthcook stew at their novice there',
      onCraftRig(sister, [], 0.1).craft(stewRow, stew, 1).baseId === burnt);
    const teaRow = { owner: 'Cook', half: 'Hearthcook', name: 'Lavender Tea' };
    const o6 = onCraftRig(novice, [], 0).craft(teaRow, idOf(TEA), 1);
    yes('3 a tea is not rolled', o6.baseId === idOf(TEA) && o6.count === 1);
    const smithRow = { owner: 'Smith', half: 'Edgewright', name: 'Iron Sword' };
    yes('3 nothing else is touched', onCraftRig(master, ['grandchef'], 0).craft(smithRow, 0x12eb7, 1).count === 1);
    yes('3 with no craftOutput from the engine nothing is named', onCraftRig(novice, [], 0.1).none(stewRow) === null);
  });
}
yes('3 nothing in the craft waits on a timer: wovenOutput is the weaver\'s alone and names through craftOutput (#3026)',
  (function () {
    const m = cut('function wovenOutput(actorId, row) {') || '';
    return m && m.indexOf('grandchef') === -1 && m.indexOf('masterchemist') === -1 && m.indexOf('addItem(') === -1 &&
      m.indexOf('setTimeout') === -1 && m.indexOf("'inventory'") === -1 && m.indexOf("'craftOutput'") !== -1 &&
      !/MASTER_CRAFT_AFTER_MS|function masterCraft\(|function markWoven\(/.test(gm);
  })());

// ----------------------------------------------- 4. the committed plugin --
function subsOf(d) {
  const out = []; let i = 0, big = null;
  while (i + 6 <= d.length) {
    const tag = d.toString('latin1', i, i + 4);
    let size = d.readUInt16LE(i + 4);
    if (tag === 'XXXX') { big = d.readUInt32LE(i + 6); i += 6 + size; continue; }
    if (big !== null) { size = big; big = null; }
    out.push({ tag: tag, body: d.subarray(i + 6, i + 6 + size) });
    i += 6 + size;
  }
  return out;
}
function readPlugin(buf) {
  const recs = [];
  const headSize = buf.readUInt32LE(4);
  const masters = subsOf(buf.subarray(24, 24 + headSize)).filter(function (s) { return s.tag === 'MAST'; })
    .map(function (s) { return s.body.toString('latin1').replace(/\0+$/, ''); });
  (function walk(p, end) {
    while (p + 24 <= end) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      const flags = buf.readUInt32LE(p + 8), fid = buf.readUInt32LE(p + 12);
      let data = buf.subarray(p + 24, p + 24 + size);
      if (flags & 0x00040000) { data = zlib.inflateSync(data.subarray(4)); }
      recs.push({ tag: tag, fid: fid, subs: subsOf(data) });
      p += 24 + size;
    }
  })(24 + headSize, buf.length);
  return { masters: masters, records: recs };
}
function zs(s) { return s ? s.body.toString('latin1').replace(/\0+$/, '') : ''; }
function sub(r, tag) { return r.subs.find(function (s) { return s.tag === tag; }); }
function localFid(desc, masters) {
  const [obj, owner] = desc.split(':');
  const at = masters.map(function (m) { return m.toLowerCase(); }).indexOf(owner.toLowerCase());
  return (((at < 0 ? masters.length : at) << 24) | parseInt(obj, 16)) >>> 0;
}
function checkRecords(plugin, label) {
  const by = new Map(plugin.records.map(function (r) { return [r.fid, r]; }));
  const fineEffect = localFid('19002:Thornswood-Content.esp', plugin.masters);
  const burntEffect = localFid('19001:Thornswood-Content.esp', plugin.masters);
  const burnt = by.get(localFid(Q.burnt, plugin.masters));
  yes(label + ' the burnt meal is there: ALCH Burnt Meal, food, the burnt effect',
    !!burnt && burnt.tag === 'ALCH' && zs(sub(burnt, 'FULL')) === 'Burnt Meal' &&
    (sub(burnt, 'ENIT').body.readUInt32LE(4) & 0x2) !== 0 && sub(burnt, 'EFID').body.readUInt32LE(0) === burntEffect);
  const bad = Object.keys(FINE).filter(function (plain) {
    const r = by.get(localFid(FINE[plain], plugin.masters));
    return !r || r.tag !== 'ALCH' || zs(sub(r, 'FULL')) !== 'Fine ' + dishes[plain] || !sub(r, 'MODL') ||
      !sub(r, 'ENIT') || (sub(r, 'ENIT').body.readUInt32LE(4) & 0x2) === 0 ||
      r.subs.filter(function (s) { return s.tag === 'EFID'; }).length !== 1 || sub(r, 'EFID').body.readUInt32LE(0) !== fineEffect;
  });
  yes(label + ' every fine dish is there: ALCH "Fine <dish>", food, wearing a mesh, the fine effect alone' +
    (bad.length ? ' (missing or wrong: ' + bad.slice(0, 5).join(', ') + (bad.length > 5 ? ', ...' : '') + ')' : ''), bad.length === 0);
  const effects = [burntEffect, fineEffect].map(function (f) { return by.get(f); });
  yes(label + ' the two effects are the plugin\'s own MGEFs, with what the server does written on them',
    effects.every(function (r) { return r && r.tag === 'MGEF' && zs(sub(r, 'DNAM')).length > 20; }));
  return by;
}
const shipped = fs.readFileSync(ESP);
const shippedPlugin = readPlugin(shipped);
checkRecords(shippedPlugin, '4');

// --------------------------------------------- 5. the tool over stand-ins --
function rec(tag, fid, subs, flags) {
  const body = Buffer.concat(subs.map(function (s) {
    const h = Buffer.alloc(6); h.write(s[0], 0, 'latin1'); h.writeUInt16LE(s[1].length, 4); return Buffer.concat([h, s[1]]);
  }));
  const h = Buffer.alloc(24); h.write(tag, 0, 'latin1'); h.writeUInt32LE(body.length, 4); h.writeUInt32LE(flags || 0, 8);
  h.writeUInt32LE(fid >>> 0, 12); h.writeUInt16LE(44, 20);
  return Buffer.concat([h, body]);
}
function grup(label, body) {
  const h = Buffer.alloc(24); h.write('GRUP', 0, 'latin1'); h.writeUInt32LE(24 + body.length, 4); h.write(label, 8, 'latin1');
  return Buffer.concat([h, body]);
}
function z(s) { return Buffer.from(s + '\0', 'latin1'); }
function u32(...v) { const b = Buffer.alloc(4 * v.length); v.forEach(function (x, i) { b.writeUInt32LE(x >>> 0, i * 4); }); return b; }
function f32(v) { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b; }
function fakePlugin(masters, alchs) {
  const head = [['HEDR', Buffer.concat([f32(1.71), u32(0, 0x1000)])]];
  masters.forEach(function (m) { head.push(['MAST', z(m)]); head.push(['DATA', Buffer.alloc(8)]); });
  return Buffer.concat([rec('TES4', 0, head), grup('ALCH', Buffer.concat(alchs))]);
}
// A dish: its bounds, a mesh of its own, MODT, the pick up and eating sounds
// (Skyrim.esm's, through the file's own numbering), weight, worth.
function dishRecord(fid, own, sound, i) {
  const enit = Buffer.concat([u32(10 + i, 0x2, sound, 0), u32(sound)]);
  return rec('ALCH', fid, [['EDID', z('Dish' + i)], ['OBND', Buffer.alloc(12, i % 7)], ['FULL', z('Dish ' + i)],
    ['MODL', z('Clutter\\Food\\Dish' + i + '.nif')], ['MODT', Buffer.alloc(12, 3)], ['YNAM', u32(sound)], ['ZNAM', u32(sound)],
    ['DATA', f32(0.5)], ['ENIT', enit], ['EFID', u32(0x3eb15)], ['EFIT', Buffer.alloc(12)]]);
}
const SOUND = 0x000c7b41;
function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8' });
    if (!p.error) { return p; }
  }
  return null;
}
const tmpRoot = process.env.TEST_TMP || os.tmpdir();
fs.mkdirSync(tmpRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tmpRoot, 'ts-2906-'));
try {
  // The shipped plugin without the records this makes, so the tool has to make them.
  const making = new Set([Q.burnt].concat(fineIds).map(function (d) { return localFid(d, shippedPlugin.masters); }));
  const headSize = shipped.readUInt32LE(4);
  const kept = [];
  (function strip(p, end, into) {
    while (p + 24 <= end) {
      const tag = shipped.toString('latin1', p, p + 4);
      const size = shipped.readUInt32LE(p + 4);
      if (tag === 'GRUP') {
        const kids = [];
        strip(p + 24, p + size, kids);
        const body = Buffer.concat(kids);
        const h = Buffer.from(shipped.subarray(p, p + 24)); h.writeUInt32LE(24 + body.length, 4);
        if (kids.length || shipped.toString('latin1', p + 8, p + 12) !== 'ALCH') { into.push(Buffer.concat([h, body])); }
        p += size; continue;
      }
      if (!making.has(shipped.readUInt32LE(p + 12))) { into.push(shipped.subarray(p, p + 24 + size)); }
      p += 24 + size;
    }
  })(24 + headSize, shipped.length, kept);
  const bare = Buffer.concat([shipped.subarray(0, 24 + headSize)].concat(kept));
  fs.writeFileSync(path.join(dir, 'Thornswood-Content.esp'), bare);

  // Stand-in masters: each dish in the file that made it, and the burnt meal's look.
  const byFile = {};
  const looks = Object.keys(FINE).concat(['721e8:Skyrim.esm']);
  looks.forEach(function (d, i) { const f = d.split(':')[1]; (byFile[f] = byFile[f] || []).push([d, i]); });
  const masters = path.join(dir, 'Data');
  fs.mkdirSync(masters);
  function writeMasters(gourmetSound) {
    for (const f in byFile) {
      const own = f === 'Gourmet.esp' ? ['Skyrim.esm'] : (f === 'Skyrim.esm' ? [] : ['Skyrim.esm']);
      const alchs = byFile[f].map(function (x) {
        const sound = f === 'Gourmet.esp' && gourmetSound !== undefined ? gourmetSound : SOUND;
        return dishRecord((own.length << 24) | parseInt(x[0].split(':')[0], 16), own, sound, x[1]);
      });
      fs.writeFileSync(path.join(masters, f), fakePlugin(own, alchs));
    }
  }
  writeMasters();
  const run = python([TOOL, '--data', dir, '--masters', masters]);
  yes('5 python is on this machine', run !== null);
  if (run) {
    yes('5 the tool makes the records from the masters and writes the plugin', run.status === 0 &&
      /Cooking quality \(#2906/.test(run.stdout) && /68 made now from the masters/.test(run.stdout));
    if (run.status !== 0) { console.log(run.stdout + run.stderr); }
    const made = readPlugin(fs.readFileSync(path.join(dir, 'Thornswood-Content.esp')));
    const by = checkRecords(made, '5');
    const stew = by.get(localFid(FINE[STEW], made.masters));
    const i = looks.indexOf(STEW);
    yes('5 a fine dish wears its plain dish\'s mesh, bounds, sounds and worth',
      !!stew && zs(sub(stew, 'MODL')) === 'Clutter\\Food\\Dish' + i + '.nif' && sub(stew, 'OBND').body.equals(Buffer.alloc(12, i % 7)) &&
      sub(stew, 'YNAM').body.readUInt32LE(0) === SOUND && sub(stew, 'ENIT').body.readUInt32LE(16) === SOUND &&
      sub(stew, 'ENIT').body.readInt32LE(0) === 10 + i);
    yes('5 with no addiction, VendorItemFood, and not the dish\'s own effect',
      !!stew && sub(stew, 'ENIT').body.readUInt32LE(8) === 0 && sub(stew, 'KWDA').body.readUInt32LE(0) === 0x0008cdea &&
      stew.subs.every(function (s) { return !(s.tag === 'EFID' && s.body.readUInt32LE(0) === 0x3eb15); }));
    const gour = Object.keys(FINE).filter(function (d) { return /Gourmet\.esp$/.test(d); })[0];
    const g1 = by.get(localFid(FINE[gour], made.masters));
    yes('5 a Gourmet dish\'s sound is moved from Gourmet\'s numbering into this plugin\'s',
      !!g1 && sub(g1, 'YNAM').body.readUInt32LE(0) === SOUND);
    const again = python([TOOL, '--data', dir, '--masters', path.join(dir, 'no-game')]);
    yes('5 run again with no game, it finds them all made and writes nothing',
      !!again && again.status === 0 && /Nothing was written/.test(again.stdout) && /68 already here, 0 made now/.test(again.stdout));

    // A Gourmet dish whose sound is Gourmet's own: this plugin does not master
    // Gourmet.esp, so it cannot point at it, and the tool says which dishes.
    fs.writeFileSync(path.join(dir, 'Thornswood-Content.esp'), bare);
    writeMasters(0x01000801);
    const stop = python([TOOL, '--data', dir, '--masters', masters]);
    const gourmetCount = Object.keys(FINE).filter(function (d) { return /Gourmet\.esp$/.test(d); }).length;
    yes('5 a dish whose look names Gourmet.esp\'s own record stops the tool, every such dish listed (' + gourmetCount + ')',
      !!stop && stop.status === 1 && new RegExp('STOP\\. ' + gourmetCount + ' of the cooking quality records').test(stop.stdout) &&
      fs.readFileSync(path.join(dir, 'Thornswood-Content.esp')).equals(bare));
  }
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
