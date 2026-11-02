// test-3152-seasonal-food.js
//
// #3152. Patrick, 22 October 2026, A: seasonal dishes can be made any time
// with the ingredients; the ingredients are what is seasonal.
//
// Cause: the season block fed the crop clock, the sky and the outdoor target
// only. No ingredient knew a season, and no dish or brew belonged to one, so
// every season ate and drank the same.
//
// It checks, without the game:
//   1. the table (game/data/food-groups.json, the gamemode's FOOD_GROUPS):
//      Lavender, Jazbay Grapes, Snowberries and Juniper Berries are each in
//      season for two seasons, so every season has exactly two; the four
//      festival dishes are feasts with a fine record each and a help; the
//      four festival brews are ale;
//   2. the content plugin: each festival dish and brew is there, an ALCH
//      carrying its own effect, and its recipe wants both of its season's
//      herbs, at the oven or the cookpot;
//   3. the real outOfSeason over a stand-in season block, and harvest()
//      asking it before the plant's wait or anything is handed over;
//   4. the real needs block: a feast is 40 hunger, its help twice as strong
//      for half as long (a fine one for 15 minutes), the guard is the
//      injury block's feast row, a later meal's help clears the doubling,
//      and a festival brew goes down as an ale.
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');

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

const GROUPS = table('FOOD_GROUPS');
const FOODS = table('FOODS');
const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'food-groups.json'), 'utf8'));
const P = 'Thornswood-Content.esp';
const LAVENDER = '45c28:Skyrim.esm', JAZBAY = '6ac4a:Skyrim.esm', SNOWBERRIES = '1b3bd:Skyrim.esm', JUNIPER = '5076e:Skyrim.esm';
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
// Each festival: its season, its feast, the feast's fine record, its brew,
// and the help the feast gives.
const FESTIVALS = [
  { season: 'spring', name: 'First Planting Loaf', feast: '1a010', fine: '1a030', brew: '1a040', brewName: 'First Planting Mead', help: 'stamina' },
  { season: 'summer', name: 'Midyear Jazbay Tart', feast: '1a011', fine: '1a031', brew: '1a041', brewName: 'Midyear Jazbay Wine', help: 'guard' },
  { season: 'autumn', name: "Harvest's End Roast", feast: '1a012', fine: '1a032', brew: '1a042', brewName: "Harvest's End Ale", help: 'stamina' },
  { season: 'winter', name: 'Saturalia Spice Cake', feast: '1a013', fine: '1a033', brew: '1a043', brewName: 'Saturalia Mulled Mead', help: 'warm' }
];
function d(local) { return local + ':' + P; }

// ------------------------------------------------------------ 1. the table --
yes('1 the gamemode\'s FOOD_GROUPS is game/data/food-groups.json exactly', JSON.stringify(GROUPS) === JSON.stringify(file));
const IN = (GROUPS && GROUPS.inSeason) || {};
yes('1 four seasonal ingredients: Lavender, Jazbay Grapes, Snowberries, Juniper Berries',
  JSON.stringify(Object.keys(IN).sort()) === JSON.stringify([LAVENDER, JAZBAY, SNOWBERRIES, JUNIPER].sort()));
yes('1 each is in season for two seasons, both real ones',
  Object.keys(IN).every(function (k) { return Array.isArray(IN[k]) && IN[k].length === 2 && IN[k].every(function (s) { return SEASONS.indexOf(s) !== -1; }); }));
const pairOf = {};
SEASONS.forEach(function (s) { pairOf[s] = Object.keys(IN).filter(function (k) { return IN[k].indexOf(s) !== -1; }).sort(); });
yes('1 every season has its own pair of two, and no two seasons share a pair',
  SEASONS.every(function (s) { return pairOf[s].length === 2; }) &&
  new Set(SEASONS.map(function (s) { return pairOf[s].join(); })).size === 4);
yes('1 the four festival dishes are feasts, and so is the fine record of each',
  FESTIVALS.every(function (f) { return GROUPS.items[d(f.feast)] === 'feast' && GROUPS.items[d(f.fine)] === 'feast'; }));
yes('1 each feast has its fine record in the quality block',
  FESTIVALS.every(function (f) { return GROUPS.quality.fine[d(f.feast)] === d(f.fine); }));
yes('1 each feast has a help, the one this test names (only a feast\'s plain record is listed)',
  !!GROUPS.feasts && Object.keys(GROUPS.feasts).length === 4 &&
  FESTIVALS.every(function (f) { return GROUPS.feasts[d(f.feast)] === f.help; }));
yes('1 the four festival brews are ale, with no fine record', FESTIVALS.every(function (f) {
  return GROUPS.items[d(f.brew)] === 'ale' && !GROUPS.quality.fine[d(f.brew)];
}));
yes('1 a feast keeps its own effect (it says what the server does), so feast is not a stripped group',
  (GROUPS.strip.groups || []).indexOf('feast') === -1);

// --------------------------------------------------------- 2. the plugin --
function subsOf(b) {
  const out = [];
  let i = 0, big = null;
  while (i + 6 <= b.length) {
    const tag = b.toString('latin1', i, i + 4);
    let size = b.readUInt16LE(i + 4);
    if (tag === 'XXXX') { big = b.readUInt32LE(i + 6); i += 6 + size; continue; }
    if (big !== null) { size = big; big = null; }
    out.push({ tag: tag, body: b.subarray(i + 6, i + 6 + size) });
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
  const parts = desc.split(':');
  const at = masters.map(function (m) { return m.toLowerCase(); }).indexOf(parts[1].toLowerCase());
  return (((at < 0 ? masters.length : at) << 24) | parseInt(parts[0], 16)) >>> 0;
}
const plugin = readPlugin(fs.readFileSync(ESP));
const by = new Map(plugin.records.map(function (r) { return [r.fid, r]; }));
const FEAST_EFFECT = localFid('1a000:' + P, plugin.masters), BREW_EFFECT = localFid('1a001:' + P, plugin.masters);
const FINE_EFFECT = localFid('19002:' + P, plugin.masters);
const OVEN = localFid('117f7:HearthFires.esm', plugin.masters), POT = localFid('a5cb3:Skyrim.esm', plugin.masters);
yes('2 the feast and brew effects are the plugin\'s own MGEFs, with what the server does written on them',
  [FEAST_EFFECT, BREW_EFFECT].every(function (f) { const r = by.get(f); return !!r && r.tag === 'MGEF' && zs(sub(r, 'DNAM')).length > 20; }));
function eats(r, effect) {
  return !!r && r.tag === 'ALCH' && !!sub(r, 'MODL') && (sub(r, 'ENIT').body.readUInt32LE(4) & 0x2) !== 0 &&
    r.subs.filter(function (s) { return s.tag === 'EFID'; }).length === 1 && sub(r, 'EFID').body.readUInt32LE(0) === effect;
}
yes('2 each feast is an ALCH named for its festival, food, wearing a mesh, the feast effect alone',
  FESTIVALS.every(function (f) { const r = by.get(localFid(d(f.feast), plugin.masters)); return eats(r, FEAST_EFFECT) && zs(sub(r, 'FULL')) === f.name; }));
yes('2 its fine record is "Fine" and its name, on the same mesh, the fine effect alone',
  FESTIVALS.every(function (f) {
    const plain = by.get(localFid(d(f.feast), plugin.masters)), r = by.get(localFid(d(f.fine), plugin.masters));
    return eats(r, FINE_EFFECT) && zs(sub(r, 'FULL')) === 'Fine ' + f.name && zs(sub(r, 'MODL')) === zs(sub(plain, 'MODL'));
  }));
yes('2 each brew is an ALCH named for its festival, in the tea\'s cup, the brew effect alone',
  FESTIVALS.every(function (f) {
    const r = by.get(localFid(d(f.brew), plugin.masters));
    return eats(r, BREW_EFFECT) && zs(sub(r, 'FULL')) === f.brewName && zs(sub(r, 'MODL')) === 'Clutter\\GlazedCup01.nif';
  }));
const recipeOf = {};
plugin.records.forEach(function (r) {
  if (r.tag !== 'COBJ' || !sub(r, 'CNAM') || !sub(r, 'BNAM')) { return; }
  recipeOf[sub(r, 'CNAM').body.readUInt32LE(0)] = {
    bench: sub(r, 'BNAM').body.readUInt32LE(0),
    inputs: r.subs.filter(function (s) { return s.tag === 'CNTO'; }).map(function (s) { return s.body.readUInt32LE(0); })
  };
});
const herbFid = {};
Object.keys(IN).forEach(function (k) { herbFid[k] = localFid(k, plugin.masters); });
function seasonalIn(rec) { return Object.keys(IN).filter(function (k) { return rec.inputs.indexOf(herbFid[k]) !== -1; }).sort(); }
yes('2 each feast\'s recipe wants exactly its season\'s pair of herbs',
  FESTIVALS.every(function (f) { const rec = recipeOf[localFid(d(f.feast), plugin.masters)]; return !!rec && seasonalIn(rec).join() === pairOf[f.season].join(); }));
yes('2 and so does each brew\'s', FESTIVALS.every(function (f) {
  const rec = recipeOf[localFid(d(f.brew), plugin.masters)]; return !!rec && seasonalIn(rec).join() === pairOf[f.season].join();
}));
yes('2 a feast is made at the oven or the cookpot, a brew at the cookpot', FESTIVALS.every(function (f) {
  const a = recipeOf[localFid(d(f.feast), plugin.masters)], b = recipeOf[localFid(d(f.brew), plugin.masters)];
  return (a.bench === OVEN || a.bench === POT) && b.bench === POT;
}));
yes('2 no recipe makes a fine feast: the server names it at the craft', FESTIVALS.every(function (f) { return !recipeOf[localFid(d(f.fine), plugin.masters)]; }));

// --------------------------------------------------- 3. out of season --
function cutFn(head) {
  const a = gm.indexOf(head);
  const b = a < 0 ? -1 : gm.indexOf('\n}\n', a);
  return (a >= 0 && b > a) ? gm.slice(a, b + 3) : null;
}
const outSrc = cutFn('function outOfSeason(plant, now) {');
yes('3 outOfSeason is in the gamemode', !!outSrc);
const harvestSrc = cutFn('function harvest(actorId, refrId, baseDesc) {');
yes('3 harvest() asks it after the rank and before the plant\'s wait and the hand over',
  !!harvestSrc && /const resting = outOfSeason\(plant\);\s*if \(resting\) return resting;/.test(harvestSrc) &&
  harvestSrc.indexOf('outOfSeason(plant)') > harvestSrc.indexOf('rankStep(actorId') &&
  harvestSrc.indexOf('outOfSeason(plant)') < harvestSrc.indexOf("lastUse.get('plant:'") &&
  harvestSrc.indexOf('outOfSeason(plant)') < harvestSrc.indexOf('addItem('));
if (outSrc) {
  attempt('3 outOfSeason over a stand-in season', function () {
    let now = 'spring';
    const g = { __thornswoodSeason: { seasonAt: function () { return now; } } };
    const out = new Function('globalThis', 'FOOD_GROUPS', outSrc + '\nreturn outOfSeason;')(g, GROUPS);
    const snow = { produce: SNOWBERRIES, name: 'Snowberries' };
    const lav = { produce: LAVENDER, name: 'Lavender' };
    const garlic = { produce: '34d22:Skyrim.esm', name: 'Garlic' };
    now = 'winter';
    yes('3 Snowberries are picked in winter', out(snow) === '');
    now = 'summer';
    const said = out(snow);
    yes('3 and not in summer, which says when they are (' + said + ')',
      said === 'This plant is bare out of season. The season for Snowberries is autumn and winter.');
    yes('3 Lavender is picked in summer', out(lav) === '');
    yes('3 a plant with no season is picked in every one', SEASONS.every(function (s) { now = s; return out(garlic) === ''; }));
    yes('3 every season picks exactly its own pair', SEASONS.every(function (s) {
      now = s;
      return Object.keys(IN).filter(function (k) { return out({ produce: k, name: k }) === ''; }).sort().join() === pairOf[s].join();
    }));
  });
}

// ------------------------------------------------------- 4. the needs block --
const a = gm.indexOf('// ==== thornswood needs: hunger, thirst and exhaustion ====');
const b = gm.indexOf('// ==== end thornswood needs ====');
const needsBlock = (a >= 0 && b > a) ? gm.slice(a, b) : null;
yes('4 the needs block is in the gamemode', !!needsBlock);
yes('4 a feast is 40 hunger, its help twice as strong for half as long (food.md)',
  /feast: \{ food: 40 \}/.test(gm) && /feast: \{ strength: 2, time: 0\.5 \},/.test(gm));
const ids = {}; let next = 0x100;
[FOODS, GROUPS].forEach(function (t) { if (t) { for (const k in t.items) { if (!ids[k]) { ids[k] = next++; } } } });
function idOf(k) { return ids[k] || 0; }
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
  const N = new Function('globalThis', 'mp', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', 'FOODS', 'FOOD_GROUPS', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    { __thornswoodHurt: hurt }, mp, { log: function () { } }, function () { return 0; }, function () { },
    function (n, f) { return f; }, function () { }, function () { }, idOf, FOODS, GROUPS);
  return { N: N, store: store, calls: calls };
}
let R = null;
attempt('4 the needs block runs', function () { R = rig(); });
if (R && R.N) {
  const N = R.N;
  let who = 1;
  function person() {
    const id = who++;
    const n = N.fresh(); n.at = Date.now(); n.food = 30; n.drink = 30; R.store[id] = n;
    return id;
  }
  const near = function (at, minutes) { return Math.abs(at - (Date.now() + minutes * 60000)) < 5000; };
  attempt('4 a spring feast', function () {
    const id = person();
    const plain = person();
    N.consumed(id, idOf(d('1a010')));
    const s = R.store[id];
    yes('4 the First Planting Loaf is 40 hunger', Math.round(s.food - 30) === 40);
    yes('4 its stamina help lasts 10 real minutes, half a meal\'s 20', s.mealHelp === 'stamina' && s.mealFeast === true && near(s.mealHelpUntil, 10));
    const base = N.effects(plain, N.read(plain)).staminaRateMult || 0;
    yes('4 and is +20% stamina recovery, twice a meal\'s 10', N.effects(id, N.read(id)).staminaRateMult - base === 20);
    yes('4 a read keeps it a feast', N.read(id).mealFeast === true);
  });
  attempt('4 a fine winter feast', function () {
    const id = person();
    const cold = person();
    N.consumed(id, idOf(d('1a033')));
    const s = R.store[id];
    yes('4 a Fine Saturalia Spice Cake fills the same 40', Math.round(s.food - 30) === 40);
    yes('4 it warms for 15 minutes, half a fine dish\'s 30', s.mealHelp === 'warm' && s.mealFeast === true && near(s.mealHelpUntil, 15));
    let warmT = null, coldT = null;
    try { warmT = N.view(id).tempTarget; coldT = N.view(cold).tempTarget; } catch (e) { console.log('view threw: ' + e.message); }
    yes('4 and the temperature target is 8 degrees warmer, twice a meal\'s 4 (' + coldT + ' to ' + warmT + ')',
      typeof warmT === 'number' && typeof coldT === 'number' && warmT - coldT === 8);
    // A plain stew afterwards replaces the feast's warmth with its own.
    const s2 = R.store[id]; s2.food = 30; s2.eatUntil = 0; R.store[id] = s2;
    N.consumed(id, idOf('f431d:Skyrim.esm'));
    yes('4 a stew after it warms by a meal\'s 4 again, the feast\'s doubling gone',
      R.store[id].mealHelp === 'warm' && R.store[id].mealFeast === false && N.view(id).tempTarget - coldT === 4);
  });
  attempt('4 a summer feast', function () {
    const id = person();
    N.consumed(id, idOf(d('1a011')));
    const call = R.calls.find(function (c) { return c[0] === 'guarded' && c[1] === id; });
    yes('4 the Midyear Jazbay Tart asks the injury block for its feast guard, for 10 minutes',
      !!call && call[2] === true && call[3] === 10);
    yes('4 and keeps no warmth or stamina of its own', !R.store[id].mealHelp && !R.store[id].mealFeast);
  });
  attempt('4 a festival brew', function () {
    const id = person();
    const line = N.consumed(id, idOf(d('1a043')));
    yes('4 Saturalia Mulled Mead goes down as an ale (' + line + ')', String(line).indexOf('You drink it down.') === 0 && R.store[id].ale === 1);
  });
} else {
  yes('4 the needs block answers', false);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
