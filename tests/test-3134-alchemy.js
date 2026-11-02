// test-3134-alchemy.js
//
// #3134. Alchemy like Oblivion (Patrick, 22 Oct, docs/DECIDED.md):
//
//   * To brew with an ingredient, the character must have eaten it first.
//     A brew with one they never ate is refused before anything is taken,
//     names it, and is not credited.
//   * Once a mix is brewed, the character remembers it, at any alchemy lab:
//     the mix, what it made and how many times, and every effect it taught.
//   * What was eaten is heard from the engine's own eat (mp.onEatItem), never
//     the client's /ate line, and only a person's ingredient counts.
//   * The cause this fixes: every spawn starts from a throwaway save, so the
//     game forgot every learned ingredient effect at login. The record is on
//     the character on the server, kept over a restart, and at arrival the
//     owner's game is taught it again (LEARN_PROPERTY's script, once per
//     stamp, through Ingredient.LearnEffect).
//
// This runs the real alchemy block out of game/gamemode.js over a fake mp
// that keeps properties as JSON the way the server does, beside the real
// recipelessCraft and the lists, the way test-1389-lists.js runs them. A
// second block over the same store is a restart.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
function doc(p) { return fs.readFileSync(path.join(REPO_DIR, 'docs', p), 'utf8').split(CR).join(''); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function cut(head) { return slice(gm, head, '\n}\n'); }

const ALCHEMY = slice(gm, '// ==== thornswood alchemy ====', '// ==== end thornswood alchemy ====');
const RULES = slice(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const listsSrc = (function () {
  const a = gm.indexOf('var MIXTURES = {');
  const b = gm.indexOf('function recipelessCraft(');
  return (a >= 0 && b > a) ? gm.slice(a, b) : null;
})();
const parts = [
  cut('function rankWord(rank) {'),
  cut('function aWord(name) {'),
  cut('function professionName(prof) {'),
  cut('function craftAnswer(actorId, row) {'),
  cut('function holdsPerk(actorId, key) {'),
  cut('function packCount(actorId, itemDesc) {'),
  cut('function wovenOutput(actorId, row) {'),
  cut('function recipelessCraft(actorId, craftedItemBaseId, workbenchId, effects) {')
];
const noProfM = /^const NO_PROFESSION_AT_A_BENCH = '([^']*)';$/m.exec(gm);
const ok = ALCHEMY && RULES && listsSrc && parts.every(function (p) { return !!p; }) && noProfM;
yes('the alchemy block, the rules, the lists and the brew gate are in the gamemode', !!ok);
if (!ok) { done(); }

// ------------------------------------------------------- a fake load order --
function put32(b, v) { v = v >>> 0; return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255].concat(b || []); }
const MGEF = {
  damageHealth: 0x3eb42, ravageStamina: 0x73f23, weaknessPoison: 0x90042, slow: 0x73f25,
  damageMagickaRegen: 0x3a2b9, lingeringStamina: 0x10fe6c, fortifyDestruction: 0x3eb03,
  restoreHealth: 0x3eb15, fortifyConjuration: 0x3eaf2, fortifyHealth: 0x3eaf3
};
// Nightshade and Deathbell are Skyrim.esm's, in their real slot order. The
// root is made up, to share two listed effects with Deathbell past its first slot.
const INGR = {
  0x2f44c: [MGEF.damageHealth, MGEF.damageMagickaRegen, MGEF.lingeringStamina, MGEF.fortifyDestruction],  // Nightshade
  0x516c8: [MGEF.damageHealth, MGEF.ravageStamina, MGEF.slow, MGEF.weaknessPoison],                      // Deathbell
  0x5f0001: [MGEF.fortifyConjuration, MGEF.fortifyDestruction, MGEF.weaknessPoison, MGEF.ravageStamina]   // a root
};
const NIGHTSHADE = 0x2f44c, DEATHBELL = 0x516c8, ROOT = 0x5f0001;
const APPLE = 0x64b3f;          // food, not an ingredient
const BREWED = 0xff001234;
const LAB = 0xff00a000;
const PERSON = 0xff000058, OTHER = 0xff000060, NPC = 0x1a67c;
const NAMES = {
  'nightshade': ['Nightshade', '2f44c:Skyrim.esm'],
  'deathbell': ['Deathbell', '516c8:Skyrim.esm'],
  'test root': ['Test Root', '5f0001:Skyrim.esm']
};

// A Date whose now() is the test's clock; anything else is the real one.
function clockDate(read) {
  const D = function () { return new (Function.prototype.bind.apply(Date, [null].concat(Array.prototype.slice.call(arguments))))(); };
  D.now = read;
  D.UTC = Date.UTC;
  D.parse = Date.parse;
  return D;
}
function descOf(n) {
  return n >= 0xff000000 ? (n - 0xff000000).toString(16) : n.toString(16) + ':Skyrim.esm';
}
function idOf(d) {
  return d.indexOf(':') === -1 ? 0xff000000 + parseInt(d, 16) : parseInt(d.split(':')[0], 16);
}

/*
  One server: a store of properties that outlives it (a restart is a second
  server over the same store), the alchemy block, and the brew gate.
*/
function server(store, opts) {
  opts = opts || {};
  const said = [], logs = [], credited = [], made = {};
  let clock = opts.clock || 1000;
  const mp = {
    makeProperty: function (name, info) { made[name] = info; },
    get: function (id, prop) {
      if (prop === 'profileId') { return id === NPC ? 0 : (id === OTHER ? 8 : 7); }
      if (prop === 'baseDesc') { return 'bench:Test.esp'; }
      const row = store[id] || {};
      return Object.prototype.hasOwnProperty.call(row, prop) ? JSON.parse(row[prop]) : undefined;
    },
    set: function (id, prop, v) {
      if (!made[prop] && prop.indexOf('private.') !== 0 && prop !== 'craftOutput') { throw new Error("Property '" + prop + "' doesn't exist"); }
      (store[id] = store[id] || {})[prop] = JSON.stringify(v);
    },
    getDescFromId: descOf,
    getIdFromDesc: idOf,
    lookupEspmRecordById: function (id) {
      if (id === idOf('bench:Test.esp')) { return { record: { type: 'FURN', editorId: 'AlchemyWorkbench', fields: [] } }; }
      if (INGR[id]) {
        return {
          record: { type: 'INGR', editorId: 'I' + id, fields: INGR[id].map(function (e) { return { type: 'EFID', data: put32([], e) }; }) },
          toGlobalRecordId: function (local) { return local; }
        };
      }
      if (id === APPLE) { return { record: { type: 'ALCH', editorId: 'Apple', fields: [] } }; }
      return null;
    }
  };
  const box = { console: { log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); } },
                mp: mp, Date: clockDate(function () { return clock; }),
                say: function (id, line) { said.push([id, line]); },
                MIXTURES: undefined,
                // The property block's itemName, which the alchemy block names things by.
                __thornswoodProperty: { itemName: function (e) {
                  const d = descOf(Number(e && e.baseId) || 0).toLowerCase();
                  for (const k in NAMES) { if (NAMES[k][1].toLowerCase() === d) { return NAMES[k][0]; } }
                  return 'something (' + d + ')';
                } } };
  box.globalThis = box;
  vm.runInNewContext(RULES, box);
  const P = box.__thornswoodProgression;
  // The lists, for MIXTURES' names.
  const T = {};
  new Function('T', 'mp', 'log', 'globalThis', 'holdsPerk', listsSrc + '\nT.MIXTURES = MIXTURES;')(
    T, { makeProperty: function () {} }, function () {}, {}, function () { return false; });
  box.MIXTURES = T.MIXTURES;
  vm.runInNewContext(ALCHEMY, box);
  const A = box.__thornswoodAlchemy;

  const state = P.pickProfession(P.fresh(), 'alchemist', 'blightbrewer').state;
  state.ranks.blightbrewer = 'master';
  const g = {
    __thornswoodProgression: P,
    __thornswoodAlchemy: A,
    __thornswoodCharacter: { stateOf: function () { return state; }, nameOf: function (k) { return k; }, masterFor: function () { return null; } }
  };
  const gate = new Function('globalThis', 'mp', 'log', 'notify', 'say', 'setTimeout', 'creditWork', 'raceGate',
    'idOf', 'addItem', 'wovenMark', 'RANK_LADDER', 'NO_PROFESSION_AT_A_BENCH', 'BENCH_BY_BASE', 'RECIPES_BY_ID',
    // The alembic (#3162): this person holds one, so the brew goes on to the
    // rules this harness checks. test-3162-bench-tools holds the refusal and the wear.
    'toolGate', 'wearTool',
    parts.join('\n') + '\n' + listsSrc + '\nreturn recipelessCraft;')(
    g, mp,
    function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    function () { },
    function (id, m) { said.push([id, m]); },
    function () { },
    function (id, half) { credited.push(half); return null; },
    function () { return ''; },
    idOf, function () { return true; }, function () { return 0; },
    ['novice', 'advanced', 'expert', 'master'], noProfM[1], {}, {},
    function () { return null; }, function () { return null; });
  return {
    A: A, mp: mp, made: made, said: said, logs: logs, credited: credited,
    at: function (t) { clock = t; },
    told: function (id) { return said.filter(function (s) { return s[0] === id; }).map(function (s) { return s[1]; }); },
    eat: function (id, base) { return A.ate(id, base); },
    // The engine's brew: the effects the ingredients share, as CraftService::BrewEffects works them out.
    brew: function (id, bases) {
      const count = {};
      const order = [];
      bases.forEach(function (b) {
        const seen = {};
        (INGR[b] || []).forEach(function (e) {
          if (seen[e]) { return; }
          seen[e] = true;
          if (!count[e]) { order.push(e); }
          count[e] = (count[e] || 0) + 1;
        });
      });
      const effects = order.filter(function (e) { return count[e] >= 2; });
      const inputs = bases.map(function (b) { return { baseId: b, count: 1 }; });
      said.length = 0; credited.length = 0;
      const out = gate(id, BREWED, LAB, effects, inputs);
      return { refused: out === false, effects: effects };
    }
  };
}

// --------------------------------------------------------------- tasting --
const store = {};
let s = server(store);
yes('T0 the block makes its record (owner cannot read) and the learn property (owner reads, with a script)',
    s.made.thornswoodAlchemy && !s.made.thornswoodAlchemy.isVisibleByOwner &&
    s.made.thornswoodAlchemyLearn && s.made.thornswoodAlchemyLearn.isVisibleByOwner &&
    !s.made.thornswoodAlchemyLearn.isVisibleByNeighbors && /learnEffect/.test(s.made.thornswoodAlchemyLearn.updateOwner));

{
  const r = s.brew(PERSON, [NIGHTSHADE, DEATHBELL]);
  yes('E1 a Blightbrewer who never ate Nightshade or Deathbell is refused the Damage Health brew',
      r.refused && r.effects.length === 1 && r.effects[0] === MGEF.damageHealth);
  yes('E1 and is told both, by name, and that the ingredients stay (' + s.told(PERSON).join(' | ') + ')',
      /never eaten Nightshade or Deathbell/.test(s.told(PERSON)[0] || '') && /stay in your pack/.test(s.told(PERSON)[0] || ''));
  yes('E1 and no work is credited', s.credited.length === 0);
}
{
  s.at(2000);
  yes('E2 eating Nightshade is a first taste', s.eat(PERSON, NIGHTSHADE) === true);
  yes('E2 and is said once', /taste of Nightshade/.test(s.told(PERSON).join(' ')));
  s.said.length = 0;
  yes('E2 a second Nightshade is not new and says nothing', s.eat(PERSON, NIGHTSHADE) === false && s.told(PERSON).length === 0);
  const r = s.brew(PERSON, [NIGHTSHADE, DEATHBELL]);
  yes('E2 the brew is still refused, naming only Deathbell (' + s.told(PERSON).join(' | ') + ')',
      r.refused && /never eaten Deathbell,/.test(s.told(PERSON)[0] || '') && !/Nightshade/.test(s.told(PERSON)[0] || ''));
}
{
  yes('E3 an apple is not an ingredient, and an NPC\'s taste does not count',
      s.eat(PERSON, APPLE) === false && s.eat(NPC, DEATHBELL) === false && !s.A.read(PERSON).eaten['516c8:Skyrim.esm']);
  yes('E3 one character\'s taste is not another\'s', s.eat(OTHER, DEATHBELL) === true && !s.A.read(PERSON).eaten['516c8:Skyrim.esm']);
}

// -------------------------------------------------------------- brewing --
{
  s.at(3000);
  s.eat(PERSON, DEATHBELL);
  const r = s.brew(PERSON, [NIGHTSHADE, DEATHBELL]);
  yes('B1 with both eaten, the brew goes through and is one piece of Blightbrewer work',
      !r.refused && s.credited.length === 1 && s.credited[0] === 'blightbrewer');
  const rec = s.A.read(PERSON);
  yes('B1 the mix is remembered: both ingredients, Damage Health, once',
      rec.recipes.length === 1 && rec.recipes[0].with.join('|') === '2f44c:Skyrim.esm|516c8:Skyrim.esm' &&
      rec.recipes[0].makes.join('|') === '3eb42:Skyrim.esm' && rec.recipes[0].times === 1);
  yes('B1 and said once, with the names (' + s.told(PERSON).join(' | ') + ')',
      /remember this mix at any alchemy lab: Nightshade and Deathbell make Damage Health/.test(s.told(PERSON).join(' ')));
  yes('B1 the first slot of each is known (eaten, and Damage Health is first on both), nothing else',
      rec.known['2f44c:Skyrim.esm'] === 1 && rec.known['516c8:Skyrim.esm'] === 1);
  s.brew(PERSON, [DEATHBELL, NIGHTSHADE]);
  const again = s.A.read(PERSON);
  yes('B2 the same mix in another order is the same recipe, twice, and is not announced again',
      again.recipes.length === 1 && again.recipes[0].times === 2 && s.told(PERSON).length === 0);
  const j = s.A.journal(PERSON);
  yes('B3 the journal names what was eaten and the mix, for #3142',
      j.eaten.join('|') === 'Deathbell|Nightshade' && j.recipes[0].with.join('|') === 'Nightshade|Deathbell' &&
      j.recipes[0].makes[0] === 'Damage Health' && j.recipes[0].times === 2);
}
{
  // A brew that teaches slots past the first: Ravage Stamina and Weakness to
  // Poison are Deathbell's second and fourth, and the root's fourth and third.
  s.eat(PERSON, ROOT);
  const r = s.brew(PERSON, [DEATHBELL, ROOT]);
  const rec = s.A.read(PERSON);
  yes('B4 a brew teaches each ingredient the slots its effects are in (Deathbell 2nd and 4th, the root 3rd and 4th)',
      !r.refused && r.effects.length === 2 && rec.known['516c8:Skyrim.esm'] === (1 | 2 | 8) &&
      rec.known['5f0001:Skyrim.esm'] === (1 | 4 | 8) && rec.known['2f44c:Skyrim.esm'] === 1);
  const off = s.brew(PERSON, [NIGHTSHADE, ROOT]);
  yes('B5 a brew the mixtures list refuses (Fortify Destruction) is not remembered and teaches nothing',
      off.refused && s.A.read(PERSON).recipes.length === 2 && s.A.read(PERSON).known['2f44c:Skyrim.esm'] === 1);
}

// ------------------------------------------------------- the owner's game --
function runScript(value, state, game) {
  const script = s.made.thornswoodAlchemyLearn.updateOwner;
  const ctx = { value: value, state: state, sp: game.sp };
  new Function('ctx', script)(ctx);
}
function fakeGame() {
  const learned = {};
  const calls = [];
  return {
    learned: learned, calls: calls,
    sp: {
      Game: { getPlayer: function () { return {}; }, getFormEx: function (id) { return INGR[id] ? { id: id } : null; } },
      Ingredient: { from: function (f) {
        if (!f) { return null; }
        return { learnEffect: function (i) { calls.push([f.id, i]); learned[f.id] = (learned[f.id] || 0) | (1 << i); } };
      } }
    }
  };
}
{
  const learn = s.mp.get(PERSON, 'thornswoodAlchemyLearn');
  const game = fakeGame();
  const st = {};
  runScript(learn, st, game);
  yes('G1 the owner\'s game is taught every known slot by form id',
      game.learned[NIGHTSHADE] === 1 && game.learned[DEATHBELL] === 11 && game.learned[ROOT] === 13);
  const n = game.calls.length;
  runScript(learn, st, game);
  yes('G1 once per stamp: the script runs every frame and teaches nothing the second time', game.calls.length === n);
}

// ------------------------------------------------------------ a restart --
{
  const s2 = server(store, { clock: 9000 });
  const rec = s2.A.read(PERSON);
  yes('R1 after a restart the character still knows what they ate and what they brewed',
      !!rec.eaten['2f44c:Skyrim.esm'] && !!rec.eaten['516c8:Skyrim.esm'] && rec.recipes.length === 2);
  const r = s2.brew(PERSON, [NIGHTSHADE, DEATHBELL]);
  yes('R1 and brews the mix without eating again, at any lab', !r.refused);
  const before = s2.mp.get(PERSON, 'thornswoodAlchemyLearn').at;
  s2.at(10000);
  s2.A.arrival(PERSON);
  const after = s2.mp.get(PERSON, 'thornswoodAlchemyLearn');
  yes('R2 arrival hands the game a new stamp with everything known, so a fresh game is taught again',
      after.at === 10000 && after.at !== before && after.learn.length === 3);
  const game = fakeGame();
  runScript(after, {}, game);
  yes('R2 and a game started from a throwaway save learns it all', game.learned[DEATHBELL] === 11 && game.learned[ROOT] === 13);
  s2.A.arrival(NPC);
  yes('R2 an NPC gets nothing', s2.mp.get(NPC, 'thornswoodAlchemyLearn') === undefined);
}

// -------------------------------------------------------------- wiring ---
{
  const code = gm.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('W1 mp.onCraft hands the inputs on to the brew gate',
      /return recipelessCraft\(actorId, craftedItemBaseId, workbenchId, effects, inputs\);/.test(code));
  const gate = cut('function recipelessCraft(actorId, craftedItemBaseId, workbenchId, effects) {') || '';
  const tasteAt = gate.indexOf('alchemy.brewRefusal(actorId, arguments[4])');
  yes('W2 the gate asks what was eaten for a lab, after the profession and before the lists, and refuses with false',
      tasteAt > gate.indexOf('if (!half) {') && tasteAt < gate.indexOf('var listed = listAnswer(') &&
      /if \(want === 'alchemist' && alchemy && alchemy\.brewRefusal\)/.test(gate) &&
      /return false;/.test(gate.slice(tasteAt, tasteAt + 400)));
  yes('W3 a brew that went through is remembered, after the work is credited',
      gate.indexOf('alchemy.brewed(actorId, arguments[4], effects)') > gate.indexOf('creditWork(actorId, half)'));
  const eatAt = gm.indexOf("mp.onEatItem = guard('onEatItem'");
  const eat = gm.slice(eatAt, gm.indexOf('\n  });', eatAt));
  yes('W4 the one onEatItem handler hands every eat to the alchemy block, never the /ate line',
      (gm.match(/mp\.onEatItem =/g) || []).length === 1 && /alchemy\.ate\(actorId, Number\(baseId\) \|\| 0\)/.test(eat) &&
      gm.slice(gm.indexOf("if (word === '/ate') {"), gm.indexOf("if (word === '/place') {")).indexOf('__thornswoodAlchemy') === -1);
  const arrival = slice(gm, '  function arrival(actorId) {', '\n  }\n') || '';
  yes('W5 the character block\'s arrival teaches the game again', /alchemy\.arrival\(actorId\)/.test(arrival));
}

// --------------------------------------------------------------- pages ---
{
  const alch = doc('systems/professions/alchemist.md');
  const mix = doc('systems/mixtures.md');
  yes('P1 the Alchemist page says the server keeps what was eaten and brewed, and you must eat it first',
      !/This server does not keep that list/.test(alch) && /eaten/.test(alch) && /remember/i.test(alch));
  yes('P2 the mixtures page says the engine names the effects now, and the eat first rule',
      !/The\s+engine does not say yet/.test(mix) && /eaten/.test(mix));
}

done();
