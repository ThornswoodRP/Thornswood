// test-3141-world-produce.js
//
//     node tests/test-3141-world-produce.js
//
// #3141. Patrick, 22 October: each gathering action is split to the class
// whose work it is, resource by resource, and not left open to everyone.
//
// Before this, a plant or tree no table in onActivate named fell out of the
// chain and the engine's own pick handed its produce to whoever pressed it.
// What this proves, against the real text of game/gamemode.js:
//   - every record harvests.json leaves unranked has its owner by name: the
//     gatherer (GATHER_UNRANKED), the farmer (CROP_RULES, CHURNS,
//     CHICKEN_NESTS, HIVES), a rack's owner (RACKS_BY_HAND), anybody or
//     nobody (WORLD_PRODUCE_ANYBODY, WORLD_PRODUCE_NOBODY). Only the three
//     Creation Club roots are on no list, because no table may name them;
//   - the HearthFires crop planters are farm plots with the field crop's own
//     produce, rank and time;
//   - the activate chain asks isWorldProduce after every table and before the
//     bodies, so a plant nobody named is refused and never reaches the engine;
//   - worldProduce lets the mammoth cheese through for anybody, gives each
//     nobody record its reason, refuses any other plant or tree and names it
//     once in the log, and leaves a door or a body alone;
//   - a rack in RACKS_BY_HAND is answered through its owner's gate, ladder,
//     waits and yields, and hands one item of its leveled list;
//   - listItems walks a leveled list, a list inside it included, and says so
//     when the list hands over nothing.
//
// Read only.
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const BOM = new RegExp('^' + String.fromCharCode(0xFEFF));
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

function table(name) {
  const m = new RegExp('^(?:var|const) ' + name + ' = (?:\\{[^\\n]*\\};$|\\{[\\s\\S]*?^\\};)', 'm').exec(src);
  return m ? m[0] : null;
}

// A table's keys, out of the real declaration.
function keysOf(name) {
  const t = table(name);
  if (!t) { return null; }
  let o = null;
  try { o = new Function('var GAME_TUNING = {}, FISH_TUNING = {}, NOBODYS_PRODUCE = "", NOT_A_HARVEST = "";\n' +
                         t + '\nreturn ' + name + ';')(); } catch (e) { o = null; }
  return o ? Object.keys(o) : null;
}

let harvests = null;
try {
  harvests = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'game', 'data', 'harvests.json'), 'utf8').replace(BOM, ''));
} catch (e) { harvests = null; }
yes('harvests.json is readable', !!harvests && !!harvests.unranked);

// ---- every unranked record has its owner by name ---------------------------
const owners = {};
for (const name of ['GATHER_UNRANKED', 'CROP_RULES', 'CHURNS', 'CHICKEN_NESTS', 'HIVES',
                    'RACKS_BY_HAND', 'WORLD_PRODUCE_ANYBODY', 'WORLD_PRODUCE_NOBODY']) {
  const keys = keysOf(name);
  yes(name + ' is in the gamemode', !!keys);
  for (const k of keys || []) { (owners[k] = owners[k] || []).push(name); }
}
if (harvests && harvests.unranked) {
  const missing = [], twice = [];
  for (const base of Object.keys(harvests.unranked)) {
    const row = harvests.unranked[base];
    if (/^cc/.test(String(row.editorId || ''))) { continue; }
    if (!owners[base]) { missing.push(base + ' ' + row.editorId); }
    else if (owners[base].length > 1) { twice.push(base + ' ' + owners[base].join('+')); }
  }
  yes('every record the pass left unranked has an owner by name, Creation Club aside' +
      (missing.length ? ': ' + missing.join(', ') : ''), missing.length === 0);
  yes('and only one' + (twice.length ? ': ' + twice.join(', ') : ''), twice.length === 0);
  const cc = Object.keys(harvests.unranked).filter(b => /^cc/.test(String(harvests.unranked[b].editorId || '')));
  yes('the Creation Club roots are on no list (' + cc.length + ')',
      cc.length === 3 && cc.every(b => !owners[b] && src.indexOf("'" + b + "'") === -1));
}

// ---- the HearthFires crop planters are the farmer's ------------------------
{
  const rulesSrc = table('CROP_RULES');
  let rules = null;
  try { rules = new Function(rulesSrc + '\nreturn CROP_RULES;')(); } catch (e) { rules = null; }
  yes('CROP_RULES reads', !!rules);
  const field = { Cabbage: 'bcf48:Skyrim.esm', Gourd: 'be3e6:Skyrim.esm', Leek: 'bb952:Skyrim.esm',
                  Carrot: '2493d:JKs Skyrim.esp', Potato: 'bcf47:Skyrim.esm', Wheat: 'bb953:Skyrim.esm' };
  const planters = { Cabbage: '1045e:HearthFires.esm', Gourd: '1045f:HearthFires.esm',
                     Leek: '10460:HearthFires.esm', Carrot: '110b9:HearthFires.esm',
                     Potato: '110ba:HearthFires.esm', Wheat: '110cd:HearthFires.esm' };
  const crops = (harvests && harvests.crops) || {};
  for (const name of Object.keys(planters)) {
    const p = rules && rules[planters[name]];
    const f = rules && rules[field[name]];
    const fieldProduce = (crops[field[name]] && crops[field[name]].produce) || (f && f.produce);
    yes('the ' + name + ' planter is a plot with the field crop\'s produce, rank and time',
        !!p && !!f && p.name === name && p.produce === fieldProduce &&
        p.rank === f.rank && p.growMinutes === f.growMinutes);
  }
}

// ---- the chain asks it last, before the bodies -----------------------------
const head = "mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {";
const hAt = src.indexOf(head);
const handler = hAt < 0 ? '' : src.slice(hAt, src.indexOf('\n});', hAt));
{
  const vein = handler.indexOf('else if (isVein(baseDesc)) message = mineOre(');
  const world = handler.indexOf('else if (isWorldProduce(baseDesc)) message = worldProduce(casterRefrId, refrId, baseDesc);');
  const bodies = handler.indexOf('const off = loot(casterRefrId, refrId, baseDesc);');
  yes('the handler asks isWorldProduce after the seams and before the bodies',
      vein > 0 && world > vein && bodies > world);
  yes('and every class table is asked before it',
      ['isCrop(baseDesc)', 'isFish(baseDesc)', 'isGame(baseDesc)', 'isChickenNest(baseDesc)',
       'isChurn(baseDesc)', 'isHive(baseDesc)', 'isPlant(baseDesc)'].every(c => {
        const at = handler.indexOf(c); return at > 0 && at < world;
      }));
  yes('an ALLOW from it goes on to the engine', /if \(message === ALLOW\) \{ return; \}/.test(handler));
}

// ---- worldProduce ----------------------------------------------------------
{
  const lists = (function () {
    const a = src.indexOf('\nvar WORLD_PRODUCE_ANYBODY = {');
    const b = src.indexOf('\nvar unownedProduceSeen = {};');
    return (a < 0 || b < 0) ? null : src.slice(a + 1, b + '\nvar unownedProduceSeen = {};'.length);
  })();
  const parts = [lists, liftFn('isWorldProduce'), liftFn('worldProduce')];
  yes('the lists and both functions are in the gamemode', parts.every(Boolean));
  const logs = [];
  const kinds = { 0x7edf0: 'FLOR', 0xf39b: 'FLOR', 0x77: 'FLOR', 0x78: 'TREE', 0x79: 'DOOR', 0x7a: 'NPC_' };
  const g = { __thornswoodSpoils: { kindOf: id => kinds[id] || '' } };
  const idOf = d => parseInt(String(d).split(':')[0], 16) || 0;
  const ALLOW = { thornswoodAllow: true };
  let api = null;
  try {
    api = new Function('globalThis', 'idOf', 'log', 'ALLOW', "'use strict';\n" + parts.join('\n') +
                       '\nreturn { isWorldProduce: isWorldProduce, worldProduce: worldProduce };')(
      g, idOf, function () { logs.push(Array.prototype.join.call(arguments, ' ')); }, ALLOW);
  } catch (e) { console.log('      would not build: ' + e.message); }
  if (api) {
    const P = 0x14;
    yes('the mammoth cheese is a world produce and goes on to the engine for anybody',
        api.isWorldProduce('7edf0:Skyrim.esm') && api.worldProduce(P, 1, '7edf0:Skyrim.esm') === ALLOW);
    yes('the mead barrel says it is sealed',
        api.worldProduce(P, 2, 'f39b:HearthFires.esm') === 'The mead barrel is sealed. Nobody draws from it here.');
    yes('a coin purse is not a harvest',
        api.worldProduce(P, 3, 'd790c:Skyrim.esm') === 'A coin purse is not a harvest. Nothing comes away.');
    yes('a plant no list names is world produce, and so is a tree',
        api.isWorldProduce('77:New.esp') && api.isWorldProduce('78:New.esp'));
    const line = 'This is nobody\'s work here, so nothing comes away.';
    const first = api.worldProduce(P, 4, '77:New.esp');
    const again = api.worldProduce(P, 5, '77:New.esp');
    yes('it is refused with the nobody sentence, every press', first === line && again === line);
    yes('and named in the log once, with its descriptor',
        logs.length === 1 && logs[0].indexOf('77:New.esp') !== -1);
    yes('a door and a body are not world produce, so the bodies and the engine keep them',
        !api.isWorldProduce('79:Skyrim.esm') && !api.isWorldProduce('7a:Skyrim.esm'));
    yes('__proto__ is not world produce',
        !api.isWorldProduce('__proto__') && !api.isWorldProduce('toString'));
  }
}

// ---- a rack in RACKS_BY_HAND -----------------------------------------------
{
  const parts = ['FISH_TUNING', 'GAME_BY_BASE', 'GAME_TUNING', 'RACKS_BY_HAND', 'RACK_OWNERS'].map(table)
    .concat(['isGame', 'rackOf', 'game'].map(liftFn));
  yes('the rack tables and game(), rackOf() and isGame() are in the gamemode', parts.every(Boolean));
  const rec = { gates: [], ladders: [], given: [], credited: [] };
  const stock = {
    readyAt: {},
    left: function (ref) { return Math.max(0, (this.readyAt[ref] || 0) - 1000); },
    take: function (ref, span, grant) {
      if (this.left(ref) > 0) { return { ok: false }; }
      const was = this.readyAt[ref];
      this.readyAt[ref] = 1000 + span;
      if (grant() === false) { this.readyAt[ref] = was; return { ok: false }; }
      return { ok: true };
    }
  };
  const lists = { '19647b:WindhelmSSE.esp': ['106e1a:Skyrim.esm'], '3c6a8:Dragonborn.esm': [] };
  let api = null;
  try {
    api = new Function('globalThis', 'withinResourceReach', 'classGate', 'rankStep', 'rankWord',
      'RANK_LADDER', 'randInt', 'addItemsAtomic', 'creditWork', 'waitWord', 'listItems',
      "'use strict';\n" + 'function economyGathered() { }\n' + parts.join('\n') + '\nreturn { game: game, isGame: isGame };')(
      { __thornswoodResourceStock: stock }, function () { return true; },
      function (a, verb) { rec.gates.push(verb); return a === 0x99 ? 'Only a fisher can fish. Ask one.' : null; },
      function (a, ladder) { rec.ladders.push(ladder); return 0; },
      function (r) { return r === 'advanced' ? 'an Advanced' : 'a ' + r; },
      ['novice', 'advanced', 'expert', 'master'],
      function (lo) { return lo; },
      function (a, goods) { rec.given.push(goods[0]); return true; },
      function (a, key) { rec.credited.push(key); return null; },
      function (s) { return Math.round(s / 60) + ' minutes'; },
      function (d) { return lists[d] || []; });
  } catch (e) { console.log('      would not build: ' + e.message); }
  if (api) {
    const fishRack = '17ba31:WindhelmSSE.esp';
    yes('the landed fish and the Skaal horker are racks',
        api.isGame(fishRack) && api.isGame('38a83:Dragonborn.esm') && !api.isGame('__proto__'));
    const said = api.game(0x14, 0x501, fishRack);
    yes('a fisher takes the hanging catch through the fish verb and the fisher ladder: "' + said + '"',
        rec.gates[0] === 'fish' && rec.ladders[0] === 'fisher' &&
        said === 'You take 1 from the hanging catch.');
    yes('and is handed one item of the record\'s list, counted as fishing',
        rec.given.length === 1 && rec.given[0].item === '106e1a:Skyrim.esm' && rec.given[0].count === 1 &&
        rec.credited.join() === 'fish');
    yes('the same rack again waits the fisher\'s novice ten minutes',
        /^This one is picked clean for now\. 10 minutes to go\.$/.test(api.game(0x14, 0x501, fishRack)));
    yes('somebody who is not a fisher is told so and handed nothing',
        api.game(0x99, 0x502, fishRack) === 'Only a fisher can fish. Ask one.' && rec.given.length === 1);
    const horker = api.game(0x14, 0x503, '38a83:Dragonborn.esm');
    yes('the horker asks for an Advanced Hunter: "' + horker + '"',
        rec.gates[rec.gates.length - 1] === 'loot' && rec.ladders[rec.ladders.length - 1] === 'hunter' &&
        horker === 'This Horker takes an Advanced Hunter. Work what you can until you are one.');
  }
}

// ---- listItems ---------------------------------------------------------------
{
  const body = liftFn('listItems');
  yes('listItems is in the gamemode', !!body);
  function lvlo(local) { return { type: 'LVLO', data: [1, 0, 0, 0, local & 0xff, (local >> 8) & 0xff, (local >> 16) & 0xff, 0, 1, 0, 0, 0] }; }
  const records = {
    0x500: { type: 'LVLI', fields: [{ type: 'LVLD', data: [0] }, lvlo(0x10), lvlo(0x10), lvlo(0x501)] },
    0x501: { type: 'LVLI', fields: [lvlo(0x20)] },
    0x10: { type: 'INGR', fields: [] },
    0x20: { type: 'INGR', fields: [] },
    0x600: { type: 'LVLI', fields: [] }
  };
  const mp = {
    lookupEspmRecordById: function (id) {
      return records[id] ? { record: records[id], toGlobalRecordId: function (l) { return l; } } : null;
    },
    getDescFromId: function (id) { return id.toString(16) + ':Test.esp'; }
  };
  const logs = [];
  let listItems = null;
  try {
    listItems = new Function('mp', 'idOf', 'log', "'use strict';\nvar LIST_ITEMS = {};\n" + body + '\nreturn listItems;')(
      mp, function (d) { return parseInt(String(d).split(':')[0], 16) || 0; },
      function () { logs.push(Array.prototype.join.call(arguments, ' ')); });
  } catch (e) { console.log('      would not build: ' + e.message); }
  if (listItems) {
    const items = listItems('500:Test.esp');
    yes('a list hands its items, an entry twice in it twice, and a list inside it to its item: ' + items.join(' '),
        items.join(' ') === '10:Test.esp 10:Test.esp 20:Test.esp');
    yes('it is read once and kept', listItems('500:Test.esp') === items);
    yes('an empty list hands nothing and says so in the log',
        listItems('600:Test.esp').length === 0 && logs.length === 1 && logs[0].indexOf('600:Test.esp') !== -1);
    yes('a list that is not loaded hands nothing', listItems('999:Gone.esp').length === 0);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
