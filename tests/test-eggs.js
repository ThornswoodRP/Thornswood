// test-eggs.js
//
// #628: a chicken nest is the farmer's; a gatherer must not get the egg.
//
// ChickenNest was a row in HARVESTS_BY_BASE because Chicken's Egg is an INGR,
// and the food rule only pulls ALCH food, so a gatherer was handed the egg.
// The fix is at the table: Build-HarvestTable.ps1 names the nest in
// FARMYARD_BY_EDITOR_ID and leaves it out of every table, collectEgg answers
// it for a farmer, and Build-RecipeTable.ps1 reads collectEgg so the Cook's
// recipes say the farmer supplies the egg. Wild bird eggs stay the gatherer's.
//
// Read only, against game/gamemode.js, game/data/harvests.json,
// game/data/recipes.json and the two build scripts. GM, HARVESTS and RECIPES
// point it at other copies (the files from before the fix fail it).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const HARVESTS_JSON = process.env.HARVESTS || path.join(ROOT, 'game', 'data', 'harvests.json');
const RECIPES_JSON = process.env.RECIPES || path.join(ROOT, 'game', 'data', 'recipes.json');
const HARVEST_PS1 = path.join(ROOT, 'scripts', 'dev', 'Build-HarvestTable.ps1');
const RECIPE_PS1 = path.join(ROOT, 'scripts', 'dev', 'Build-RecipeTable.ps1');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function liftFn(name) {
  const a = src.indexOf('\nfunction ' + name + '(');
  if (a < 0) { return null; }
  const open = src.indexOf('{', a);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (!depth) { return src.slice(a + 1, i + 1); } }
  }
  return null;
}

function liftHandler() {
  const head = "mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {";
  const a = src.indexOf(head);
  if (a < 0) { return null; }
  const f = a + head.indexOf('function');
  const open = src.indexOf('{', f);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (!depth) { return src.slice(f, i + 1); } }
  }
  return null;
}

function constLine(name) {
  const m = new RegExp('^const ' + name + ' = [^;\\n]*;', 'm').exec(src);
  return m ? m[0] : null;
}

function constBlock(name) {
  const a = src.indexOf('\nconst ' + name + ' = {');
  if (a < 0) { return null; }
  const open = src.indexOf('{', a);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') {
      depth--;
      if (!depth) {
        const end = src.indexOf(';', i);
        return src.slice(a + 1, end + 1);
      }
    }
  }
  return null;
}

function coolBlock() {
  const a = src.indexOf('\nconst COOLDOWN_MS = ');
  const s = liftFn('stampCooldown');
  if (a < 0 || !s) { return null; }
  const b = src.indexOf(s, a);
  return b < 0 ? null : src.slice(a + 1, b + s.length);
}

const NEST = '1062d1:Skyrim.esm';
const EGG = '23d77:Skyrim.esm';
const FLOWER = '134aa:Skyrim.esm'; // not a nest
const THRUSH = '23cff:Skyrim.esm'; // a pine thrush nest, wild, the gatherer's
const WARBLER = '7e8c9:Skyrim.esm'; // a rock warbler nest, wild, the gatherer's

const itemsLine = constLine('ITEMS');
let ITEMS = {};
try { ITEMS = JSON.parse(/^const ITEMS = (\{.*\});$/.exec(itemsLine)[1]); } catch (e) { ITEMS = {}; }
yes('ITEMS carries Chicken\'s Egg as chickenEgg, 23d77:Skyrim.esm', ITEMS.chickenEgg === EGG);

const parts = {
  nestsLine: constBlock('CHICKEN_NESTS'),
  waitLine: constLine('HARVEST_COOLDOWN_MS'),
  coolBlock: coolBlock(),
  isChickenNest: liftFn('isChickenNest'),
  collectEgg: liftFn('collectEgg'),
  plantAt: liftFn('plantAt'),
  waitWord: liftFn('waitWord'),
  handler: liftHandler()
};
yes('collectEgg() is in the gamemode', !!parts.collectEgg);
yes('and isChickenNest() and CHICKEN_NESTS beside it', !!parts.isChickenNest && !!parts.nestsLine);
yes('the nest waits HARVEST_COOLDOWN_MS',
    !!parts.collectEgg && /cooldownLeft\(actorId, refrId, HARVEST_COOLDOWN_MS\)/.test(parts.collectEgg) &&
    !!parts.waitLine);
yes('collectEgg logs the nest press for the #628 measurement',
    !!parts.collectEgg && /egg: chicken nest press/.test(parts.collectEgg));
yes('a non-farmer gets a refusal string, not null (FLOR must not fall through)',
    !!parts.collectEgg && /if \(refusal\) return refusal;/.test(parts.collectEgg));
yes('the success toast says the egg was taken',
    !!parts.collectEgg && /You take 1 Chicken's Egg/.test(parts.collectEgg));
// The generated plant table, lifted whole, so plantAt below runs against what
// the server really carries rather than a stub.
function harvestsBlock() {
  const a = src.indexOf('\nvar HARVESTS_BY_BASE = {');
  const b = src.indexOf('\n};', a);
  if (a < 0 || b < 0) { return null; }
  try { return new Function('return ' + src.slice(a + '\nvar HARVESTS_BY_BASE = '.length, b + 2) + ';')(); }
  catch (e) { return null; }
}
const HARVESTS_BY_BASE = harvestsBlock();
function gatherUnrankedBlock() {
  const a = src.indexOf('\nconst GATHER_UNRANKED = {');
  const b = src.indexOf('\n};', a);
  if (a < 0 || b < 0) { return {}; }
  try { return new Function('return ' + src.slice(a + '\nconst GATHER_UNRANKED = '.length, b + 2) + ';')(); }
  catch (e) { return {}; }
}
const GATHER_UNRANKED = gatherUnrankedBlock();
yes('the generated HARVESTS_BY_BASE block lifts', !!HARVESTS_BY_BASE && Object.keys(HARVESTS_BY_BASE).length > 50);
yes('and carries no chicken nest, so no plant path can hand a gatherer the egg',
    !!HARVESTS_BY_BASE && !Object.prototype.hasOwnProperty.call(HARVESTS_BY_BASE, NEST));
yes('plantAt carries no nest special case: the table is the fix, not a guard over it',
    !!parts.plantAt && !/isChickenNest/.test(parts.plantAt));
yes('the activate handler calls collectEgg before the plants',
    !!parts.handler && /isChickenNest\(baseDesc\)/.test(parts.handler) &&
    parts.handler.indexOf('collectEgg(') < parts.handler.indexOf('isPlant(baseDesc)'));
// #3080: the fork blocks the press, so a refused one empties nothing and
// nothing is put back (test-3080-flora-blocked.js has the look).
yes('and puts nothing back: the press never emptied the nest',
    !!parts.handler && /collectEgg\(/.test(parts.handler) &&
    !/putBack\(/.test(parts.handler.slice(parts.handler.indexOf('collectEgg('),
      parts.handler.indexOf('isChurn(baseDesc)'))));

const FARMER = 0x14a, GATHERER = 0x14b, NOCLASS = 0x14c, FARMER2 = 0x14d;
const FARM_NO = 'Only a farmer can bring a crop in. Ask one.';
const NO_CLASS = 'You have not chosen a class yet. Press K and choose one.';

function world(opts) {
  const o = opts || {};
  const clock = { now: 1700000000000 };
  const rec = { gates: [], given: [], credited: [], putBack: [], told: [], branch: [], logs: [] };
  const bases = o.bases || {};
  const classGate = function (actorId, verb) {
    rec.gates.push(verb);
    if (actorId === FARMER || actorId === FARMER2) { return null; }
    if (actorId === NOCLASS) { return NO_CLASS; }
    return FARM_NO;
  };
  const addItem = function (actorId, desc, n) {
    if (o.unloadable) { return false; }
    rec.given.push({ actorId: actorId, desc: desc, n: n });
    return true;
  };
  const creditWork = function (actorId, key) { rec.credited.push(key); return o.rankLine || null; };
  const putBack = function (actorId, refrId) { rec.putBack.push({ actorId: actorId, refrId: refrId }); };
  const mp = {
    get: function (id, key) {
      if (key === 'baseDesc') {
        if (!Object.prototype.hasOwnProperty.call(bases, id)) { throw new Error('no such reference'); }
        return bases[id];
      }
      return null;
    },
    getDescFromId: function () { return null; }
  };
  const tag = function (name) {
    return function () { rec.branch.push(name); return 'answered by ' + name; };
  };
  const never = function () { return false; };
  const loot = function () { rec.branch.push('loot'); return null; };
  const names = ['classGate', 'addItem', 'creditWork', 'putBack', 'Date', 'benchGate',
    'notify', 'say', 'globalThis', 'mp', 'kindIsContainer', 'STATIONS', 'mineSalt',
    'burnCharcoal', 'isChoppingBlock', 'chopWood', 'SHRINES', 'bless', 'isCrop',
    'farmActivate', 'isFish', 'fish', 'isGame', 'game', 'isPlant', 'harvest', 'ALLOW',
    'isVein', 'mineOre', 'loot', 'milk', 'log', 'ITEMS', 'floraHanded', 'isChurn', 'churn',
    'HARVESTS_BY_BASE', 'HARVESTS', 'isStation', 'GATHER_UNRANKED', 'isHive', 'hive'];
  const body = "'use strict';\n" + 'function economyGathered() { }\n' +
    [parts.coolBlock, parts.waitLine, parts.nestsLine,
     parts.waitWord, parts.isChickenNest, parts.collectEgg, parts.plantAt].filter(Boolean).join('\n') + '\n' +
    'const onActivate = ' + (parts.handler || 'null') + ';\n' +
    'return { collectEgg: typeof collectEgg === "function" ? collectEgg : null,\n' +
    '         isChickenNest: typeof isChickenNest === "function" ? isChickenNest : null,\n' +
    '         plantAt: typeof plantAt === "function" ? plantAt : null,\n' +
    '         onActivate: onActivate };';
  let api = null;
  try {
    api = new Function(names.join(','), body).apply(null, [
      classGate, addItem, creditWork, putBack, { now: function () { return clock.now; } },
      function () { return null; },
      function (id, text) { rec.told.push(text); },
      function () { },
      {},
      mp, never, {},
      tag('mineSalt'), tag('burnCharcoal'), never, tag('chopWood'), {}, tag('bless'),
      never, tag('farmActivate'),
      never, tag('fish'), never, tag('game'),
      function (d) { return d === FLOWER; }, tag('harvest'),
      { thornswoodAllow: true }, never, tag('mineOre'), loot,
      function () { return null; },
      function () { rec.logs.push(Array.prototype.slice.call(arguments).join(' ')); },
      ITEMS,
      function (message) {
        return typeof message === 'string' && /^(You pick |You take )/.test(message);
      },
      never, function () { return null; },
      HARVESTS_BY_BASE || {},
      {},
      never,
      GATHER_UNRANKED || {},
      function () { return false; },
      function () { return null; }
    ]);
  } catch (e) {
    console.log('      the world would not build: ' + e.message);
    api = null;
  }
  return { api: api, rec: rec, clock: clock };
}

{
  const w = world();
  yes('collectEgg and the handler compile together', !!w.api && typeof w.api.onActivate === 'function');
  const collectEgg = w.api && w.api.collectEgg;
  const isChickenNest = w.api && w.api.isChickenNest;
  const plantAt = w.api && w.api.plantAt;
  const REF = 0xB001;

  if (isChickenNest) {
    yes('isChickenNest is true for ChickenNest and false for a flower and __proto__',
        isChickenNest(NEST) === true && isChickenNest(FLOWER) === false &&
        isChickenNest('__proto__') === false);
  }
  if (plantAt) {
    yes('plantAt returns null for the chicken nest so harvest never sees it',
        plantAt(NEST) === null);
    const thrush = plantAt(THRUSH);
    const warbler = plantAt(WARBLER);
    yes('wild bird nests are still the gatherer\'s (Pine Thrush Egg, Rock Warbler Egg)',
        !!thrush && thrush.name === 'Pine Thrush Egg' && !!warbler && warbler.name === 'Rock Warbler Egg');
  }

  if (collectEgg) {
    const first = collectEgg(FARMER, REF, NEST);
    yes('a farmer at the nest is told they took one Chicken\'s Egg',
        first === "You take 1 Chicken's Egg.");
    yes('and is handed exactly one of 23d77:Skyrim.esm', w.rec.given.length === 1 &&
        w.rec.given[0].actorId === FARMER && w.rec.given[0].desc === EGG && w.rec.given[0].n === 1);
    yes('the gate asked was the farm verb', w.rec.gates.length === 1 && w.rec.gates[0] === 'farm');
    yes('and the work is counted under the farm verb', w.rec.credited.join() === 'farm');
    yes('the nest press was logged', w.rec.logs.some(function (l) { return /egg: chicken nest press/.test(l); }));

    w.clock.now += 60000;
    const again = collectEgg(FARMER, REF, NEST);
    yes('the same farmer a minute later is told how long is left',
        again === 'You have taken from this nest for now. 9 minutes to go.');
    yes('and gets nothing more', w.rec.given.length === 1);

    const gather = collectEgg(GATHERER, REF + 1, NEST);
    yes('a gatherer is refused with the farm gate sentence', gather === FARM_NO);
    yes('and is handed nothing', w.rec.given.length === 1);

    const none = collectEgg(NOCLASS, REF + 2, NEST);
    yes('somebody with no class is refused', none === NO_CLASS);

    yes('a flower is not a nest, so collectEgg answers null',
        collectEgg(FARMER, REF + 3, FLOWER) === null);

    const other = collectEgg(FARMER2, REF, NEST);
    yes('a second farmer is not held by the first one\'s wait',
        other === "You take 1 Chicken's Egg." && w.rec.given.length === 2);
  }
}

// onActivate: a farmer takes the egg; a gatherer is refused and nothing is put back
{
  const REF = 0xC010;
  const w = world({ bases: { [REF]: NEST } });
  if (w.api && w.api.onActivate) {
    const ans = w.api.onActivate(REF, FARMER);
    yes('onActivate on a nest for a farmer returns false (blocks the engine)', ans === false);
    yes('and tells them they took the egg', w.rec.told.some(function (t) {
      return t === "You take 1 Chicken's Egg.";
    }));
    yes('and does not put the nest back after a real take', w.rec.putBack.length === 0);
    yes('and handed one egg', w.rec.given.length === 1 && w.rec.given[0].desc === EGG);
  }
}
{
  const REF = 0xC011;
  const w = world({ bases: { [REF]: NEST } });
  if (w.api && w.api.onActivate) {
    w.api.onActivate(REF, GATHERER);
    yes('onActivate on a nest for a gatherer puts nothing back (#3080: the press never emptied it)',
        w.rec.putBack.length === 0);
    yes('and hands them nothing', w.rec.given.length === 0);
    yes('and tells them the farm gate sentence', w.rec.told.indexOf(FARM_NO) >= 0);
  }
}

// The harvest table: the nest is out of the gatherer's table and listed, with
// the reason, among the rows no table carries.
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; }
}
{
  const h = readJson(HARVESTS_JSON);
  yes('game/data/harvests.json reads', !!h && !!h.harvests && !!h.unranked);
  if (h && h.harvests && h.unranked) {
    yes('the chicken nest is not in its harvests map', !Object.prototype.hasOwnProperty.call(h.harvests, NEST));
    yes('nor in crops, fish or game',
        !Object.prototype.hasOwnProperty.call(h.crops || {}, NEST) &&
        !Object.prototype.hasOwnProperty.call(h.fish || {}, NEST) &&
        !Object.prototype.hasOwnProperty.call(h.game || {}, NEST));
    const u = h.unranked[NEST];
    yes('it is in unranked as ChickenNest, giving Chicken\'s Egg',
        !!u && u.editorId === 'ChickenNest' && u.produce === EGG);
    yes('and says why: FARMYARD_BY_EDITOR_ID and collectEgg',
        !!u && /FARMYARD_BY_EDITOR_ID/.test(u.why) && /collectEgg/.test(u.why));
    yes('the count matches the harvests map', h.count === Object.keys(h.harvests).length);
    yes('the wild bird nests are still in the gatherer\'s map',
        !!h.harvests[THRUSH] && !!h.harvests[WARBLER]);
    if (HARVESTS_BY_BASE) {
      yes('and the gamemode block is the json\'s harvests map, row for row',
          JSON.stringify(Object.keys(HARVESTS_BY_BASE).sort()) === JSON.stringify(Object.keys(h.harvests).sort()));
    }
  }
}

// The two build scripts say so, so the next run of either keeps it.
{
  const hs = fs.existsSync(HARVEST_PS1) ? fs.readFileSync(HARVEST_PS1, 'utf8') : '';
  yes('Build-HarvestTable.ps1 names ChickenNest in FARMYARD_BY_EDITOR_ID',
      /^\$FARMYARD_BY_EDITOR_ID = @\([^)]*'ChickenNest'[^)]*\)/m.test(hs));
  yes('and routes that list out before anything is ranked',
      /if \(\$FARMYARD_BY_EDITOR_ID -contains \[string\]\$p\.Edid\)/.test(hs));
  const rs = fs.existsSync(RECIPE_PS1) ? fs.readFileSync(RECIPE_PS1, 'utf8') : '';
  yes('Build-RecipeTable.ps1 reads collectEgg as the farmer\'s',
      /@\{ Fn = 'collectEgg';\s+Who = 'farmer';/.test(rs));
}

// The recipe table: every recipe that asks for Chicken's Egg says the farmer
// supplies it, at novice, and none still says the gatherer.
{
  const r = readJson(RECIPES_JSON);
  let asks = 0, farmer = 0, gatherer = 0, novice = 0;
  [r && r.recipes, r && r.unowned].forEach(function (rows) {
    if (!rows || typeof rows !== 'object') { return; }
    Object.keys(rows).forEach(function (k) {
      const row = rows[k];
      if (!row || !Array.isArray(row.inputItems)) { return; }
      row.inputItems.forEach(function (i) {
        if (i.item !== EGG) { return; }
        asks++;
        if (i.producedBy === 'farmer') { farmer++; }
        const also = (i.alsoProducedBy || []).map(function (a) { return a && a.who; });
        if (i.producedBy === 'gatherer' || also.indexOf('gatherer') >= 0) { gatherer++; }
        if (i.producedAt === 'novice') { novice++; }
      });
    });
  });
  yes('game/data/recipes.json has recipes that ask for Chicken\'s Egg', asks > 0);
  yes('every one says the farmer produces it (' + farmer + ' of ' + asks + ')', asks > 0 && farmer === asks);
  yes('at novice, which is collectEgg with no rank gate (' + novice + ' of ' + asks + ')', asks > 0 && novice === asks);
  yes('and none says a gatherer does', gatherer === 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
