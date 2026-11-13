// test-milk.js
//
// #396: a farmer milks a living cow; everybody else and a dead cow fall through.
//
// Beside loot(), not inside it. loot() already falls through for a living
// actor, and that fall through is what every other living press stands on.
// milk() must return null for a non-farmer so onActivate does not block them.
// A dead cow still goes to loot() for the hunter.
//
// Goats and a milking rank wait on Patrick (issue step 4).
//
// Read only against game/gamemode.js.
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const BOM = new RegExp('^' + String.fromCharCode(0xFEFF));
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

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

function coolBlock() {
  const a = src.indexOf('\nconst COOLDOWN_MS = ');
  const s = liftFn('stampCooldown');
  if (a < 0 || !s) { return null; }
  const b = src.indexOf(s, a);
  return b < 0 ? null : src.slice(a + 1, b + s.length);
}

const COW = '23a90:Skyrim.esm'; // RoriksteadCow-ish vanilla cow base
const MILK = '3534:HearthFires.esm';
const CHURN = 'bc0:HearthFires.esm';

const itemsLine = constLine('ITEMS');
let ITEMS = {};
try { ITEMS = JSON.parse(/^const ITEMS = (\{.*\});$/.exec(itemsLine)[1]); } catch (e) { ITEMS = {}; }
yes('ITEMS carries Jug of Milk as milk, 3534:HearthFires.esm', ITEMS.milk === MILK);

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

const parts = {
  cowsLine: constBlock('MILK_COWS'),
  waitLine: constLine('HARVEST_COOLDOWN_MS'),
  coolBlock: coolBlock(),
  isMilkCow: liftFn('isMilkCow'),
  milk: liftFn('milk'),
  waitWord: liftFn('waitWord'),
  handler: liftHandler()
};
yes('milk() is in the gamemode', !!parts.milk);
yes('and isMilkCow() and MILK_COWS beside it', !!parts.isMilkCow && !!parts.cowsLine);
yes('milk waits HARVEST_COOLDOWN_MS',
    !!parts.milk && /cooldownLeft\(actorId, refrId, HARVEST_COOLDOWN_MS\)/.test(parts.milk) &&
    !!parts.waitLine);
yes('the activate handler is in the gamemode', !!parts.handler);
yes('onActivate calls milk before loot',
    !!parts.handler && /const milked = milk\(/.test(parts.handler) &&
    parts.handler.indexOf('const milked = milk(') < parts.handler.indexOf('const off = loot('));
yes('milk logs the living cow press for the #396 measurement',
    !!parts.milk && /milk: living cow press/.test(parts.milk));
yes('non-farmers return null, not a refusal',
    !!parts.milk && /if \(refusal\) return null;/.test(parts.milk));

const FARMER = 0x14a, GATHERER = 0x14b, NOCLASS = 0x14c, HUNTER = 0x14e;
const logs = [];

function world(opts) {
  const o = opts || {};
  const clock = { now: 1700000000000 };
  const rec = { gates: [], given: [], credited: [], told: [], branch: [], logs: [] };
  const bases = o.bases || {};
  const actors = o.actors || {};
  const classGate = function (actorId, verb) {
    rec.gates.push(verb);
    if (actorId === FARMER) { return null; }
    if (actorId === NOCLASS) { return 'You have not chosen a class yet. Press K and choose one.'; }
    return 'Only a farmer can bring a crop in. Ask one.';
  };
  const addItem = function (actorId, desc, n) {
    if (o.unloadable) { return false; }
    rec.given.push({ actorId: actorId, desc: desc, n: n });
    return true;
  };
  const creditWork = function (actorId, key) { rec.credited.push(key); return o.rankLine || null; };
  const putBack = function () { };
  const mp = {
    get: function (id, key) {
      if (key === 'baseDesc') {
        if (!Object.prototype.hasOwnProperty.call(bases, id)) { throw new Error('no such reference'); }
        return bases[id];
      }
      if (key === 'type') { return actors[id] ? 'MpActor' : 'MpObjectReference'; }
      if (key === 'isDead') { return !!(actors[id] && actors[id].dead); }
      return null;
    },
    getDescFromId: function () { return null; }
  };
  const tag = function (name) {
    return function () { rec.branch.push(name); return 'answered by ' + name; };
  };
  const never = function () { return false; };
  const loot = function (actorId, refrId) {
    rec.branch.push('loot');
    const a = actors[refrId];
    if (!a || !a.dead) { return null; }
    return 'You take 1 Cow Hide off the Cow.';
  };
  const names = ['classGate', 'addItem', 'creditWork', 'putBack', 'Date', 'benchGate',
    'notify', 'say', 'globalThis', 'mp', 'kindIsContainer', 'STATIONS', 'mineSalt',
    'burnCharcoal', 'isChoppingBlock', 'chopWood', 'SHRINES', 'bless', 'isCrop',
    'farmActivate', 'isFish', 'fish', 'isGame', 'game', 'isChickenNest', 'collectEgg',
    'isPlant', 'harvest', 'ALLOW',
    'isVein', 'mineOre', 'loot', 'log', 'ITEMS', 'floraHanded', 'isChurn', 'churn', 'isHive', 'hive',
    'isWorldProduce', 'worldProduce'];
  const body = "'use strict';\n" + 'function economyGathered() { }\n' +
    [parts.coolBlock, parts.waitLine, parts.cowsLine,
     parts.waitWord, parts.isMilkCow, parts.milk].filter(Boolean).join('\n') + '\n' +
    'const onActivate = ' + (parts.handler || 'null') + ';\n' +
    'return { milk: typeof milk === "function" ? milk : null,\n' +
    '         isMilkCow: typeof isMilkCow === "function" ? isMilkCow : null,\n' +
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
      never, function () { return null; },
      never, tag('harvest'),
      { thornswoodAllow: true }, never, tag('mineOre'), loot,
      function () { rec.logs.push(Array.prototype.slice.call(arguments).join(' ')); },
      ITEMS,
      function () { return false; },
      never, function () { return null; },
      function () { return false; },
      function () { return null; },
      never, tag('worldProduce')
    ]);
  } catch (e) {
    console.log('      the world would not build: ' + e.message);
    api = null;
  }
  return { api: api, rec: rec, clock: clock };
}

{
  const w = world();
  yes('milk and the handler compile together', !!w.api && typeof w.api.onActivate === 'function');
  const milk = w.api && w.api.milk;
  const REF = 0xA001;
  if (milk) {
    // Direct milk() calls need type/isDead on the refr - milk reads mp itself.
    // Rebuild with actors for the cow ref.
  }
}

{
  const bases = {}; bases[0xA001] = COW; bases[0xA002] = COW; bases[0xA003] = CHURN;
  const actors = {}; actors[0xA001] = { dead: false }; actors[0xA002] = { dead: true };
  const w = world({ bases: bases, actors: actors });
  const milk = w.api && w.api.milk;
  const on = w.api && w.api.onActivate;

  if (milk) {
    const first = milk(FARMER, 0xA001, COW);
    yes('a farmer milking a living cow is told they milked one Jug of Milk',
        first === 'You milk 1 Jug of Milk.');
    yes('and is handed exactly one of 3534:HearthFires.esm',
        w.rec.given.length === 1 && w.rec.given[0].desc === MILK && w.rec.given[0].n === 1);
    yes('the gate asked was the farm verb', w.rec.gates.join() === 'farm');
    yes('and the work is counted under farm', w.rec.credited.join() === 'farm');
    yes('the living cow press was logged for the #396 measurement',
        w.rec.logs.some(function (l) { return /milk: living cow press/.test(l); }));

    w.clock.now += 60000;
    const again = milk(FARMER, 0xA001, COW);
    yes('the same farmer a minute later is told how long is left',
        again === 'You have milked this cow for now. 9 minutes to go.');
    yes('and gets nothing more', w.rec.given.length === 1);

    const g = milk(GATHERER, 0xA001, COW);
    yes('a gatherer at a living cow gets null (fall through), not a refusal', g === null);
    yes('and was not handed milk', w.rec.given.length === 1);

    const n = milk(NOCLASS, 0xA001, COW);
    yes('somebody with no class also gets null', n === null);

    const dead = milk(FARMER, 0xA002, COW);
    yes('a dead cow returns null so loot() can take it', dead === null);

    yes('milk() answers null for a churn and for __proto__',
        milk(FARMER, 0xA001, CHURN) === null && milk(FARMER, 0xA001, '__proto__') === null);
    yes('isMilkCow is true for the cow and false for the churn',
        w.api.isMilkCow(COW) === true && w.api.isMilkCow(CHURN) === false &&
        w.api.isMilkCow('__proto__') === false);
  }

  if (on) {
    const r = on(0xA001, FARMER);
    // farmer already on cooldown from above if same world - use fresh world
  }
}

{
  const bases = {}; bases[0xB001] = COW; bases[0xB002] = COW;
  const actors = {}; actors[0xB001] = { dead: false }; actors[0xB002] = { dead: true };
  const w = world({ bases: bases, actors: actors });
  const on = w.api && w.api.onActivate;
  if (on) {
    const r = on(0xB001, FARMER);
    yes('onActivate: a farmer on a living cow is answered by the server', r === false);
    yes('and was given milk', w.rec.given.length === 1 && w.rec.given[0].desc === MILK);
    yes('and was told so', w.rec.told.indexOf('You milk 1 Jug of Milk.') !== -1);
    yes('loot was not asked for the living cow', w.rec.branch.indexOf('loot') === -1);

    const g0 = w.rec.given.length;
    const r2 = on(0xB001, GATHERER);
    yes('onActivate: a gatherer on a living cow falls through (undefined)', r2 === undefined);
    yes('and gets no milk', w.rec.given.length === g0);

    const dead = on(0xB002, HUNTER);
    yes('onActivate: a dead cow still goes to loot()', dead === false &&
        w.rec.branch[w.rec.branch.length - 1] === 'loot');
  }
}

{
  const w = world({ rankLine: 'You are now an Advanced Farmer.',
    bases: (function () { const b = {}; b[0xC001] = COW; return b; })(),
    actors: (function () { const a = {}; a[0xC001] = { dead: false }; return a; })() });
  yes('a new farm rank is said after the milk',
      !!w.api && w.api.milk(FARMER, 0xC001, COW) ===
      'You milk 1 Jug of Milk. You are now an Advanced Farmer.');
}

{
  const bases = {}; bases[0xD001] = COW;
  const actors = {}; actors[0xD001] = { dead: false };
  const w = world({ unloadable: true, bases: bases, actors: actors });
  yes('with HearthFires missing the farmer is told so',
      !!w.api && /nothing in this load order/.test(w.api.milk(FARMER, 0xD001, COW) || ''));
}

// Cow bases match hunts.json name=Cow rows
{
  let h = null;
  try {
    h = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'data', 'hunts.json'), 'utf8').replace(BOM, ''));
  } catch (e) { h = null; }
  yes('hunts.json is readable', !!h);
  if (h && h.hunts) {
    const cows = [];
    for (const k of Object.keys(h.hunts)) {
      if (h.hunts[k] && h.hunts[k].name === 'Cow') cows.push(k);
    }
    const line = parts.cowsLine || '';
    let allIn = cows.length > 0;
    for (const c of cows) {
      if (line.indexOf("'" + c + "'") === -1) allIn = false;
    }
    yes('every hunts.json Cow base is in MILK_COWS (' + cows.length + ')', allIn);
    yes('and goats are not (Patrick still decides)',
        line.indexOf('Goat') === -1 && !/'5487e:Skyrim.esm'/.test(line));
  }
}

{
  const said = [];
  const bases = {}; bases[0xE001] = COW;
  const actors = {}; actors[0xE001] = { dead: false };
  const w = world({ bases: bases, actors: actors });
  if (w.api && w.api.milk) {
    said.push(w.api.milk(FARMER, 0xE001, COW));
    said.push(w.api.milk(FARMER, 0xE001, COW));
  }
  const bad = said.filter(function (s) {
    return typeof s !== 'string' || /player/i.test(s) || s.indexOf(String.fromCharCode(0x2014)) !== -1;
  });
  yes('every sentence milk() says is plain words: no "player", no em dash',
      said.length === 2 && bad.length === 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
