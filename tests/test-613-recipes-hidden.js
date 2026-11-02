// test-613-recipes-hidden.js
//
// #613. Patrick, reporting the forge on 25 September: "It should only show if
// you can craft it with your level+half+race". Skyrim's crafting menu lists
// every recipe whose workbench keyword is the bench's, on the machine in front
// of the person, and nothing about a profession, a half, a rank, a roll or a
// race is on that machine. So the server hands the owner the rows craftAnswer
// refuses them (handRecipesHidden), and the owner's script takes each one's
// workbench keyword off the record in that game, and puts it back when the
// answer changes.
//
// This runs the real rules, the real character store and the real craft gate
// out of game/gamemode.js over a fake mp that keeps properties as JSON the way
// the server does, then runs the real owner script over a fake game with every
// recipe of the table in it. What it holds:
//
//   - a row is listed exactly when craftAnswer lets the person make it, for
//     every row of the table and for every kind of person tried;
//   - writing the character is what hands the list, and a write that changes
//     nothing about it sends nothing;
//   - the script hides, puts back the keyword the record had, acts once per
//     list, and spreads a long list over frames;
//   - a recipe moved in each game (#3120) goes out with the list, is moved
//     to its trade's bench once, and comes back there, not to its mod's
//     bench, after it was hidden.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(REPO, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function between(a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j) : null;
}
function take(start, end) {
  const i = src.indexOf(start);
  const j = i < 0 ? -1 : src.indexOf(end || '\n}\n', i);
  return (i >= 0 && j >= 0) ? src.slice(i, j + (end || '\n}\n').length) : null;
}

const RULES = between('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between('// ==== thornswood character ====', '// ==== end thornswood character ====');
const GATE_PARTS = [
  take('function craftAnswer(actorId, row) {'),
  take('function raceGate(actorId, row) {'),
  take('var RACE_CALLED = {', '\n};\n'),
  take('function professionName(prof) {'),
  take('function aWord(name) {'),
  take('function rankWord(rank) {'),
  take('function onCraftRoll(actorId, roll) {')
];
const HIDE_PARTS = [
  take('function recipesHiddenScript() {'),
  take('function recipesRefused(actorId) {'),
  take('function recipesMoved() {'),
  take('function handRecipesHidden(actorId) {')
];
const PER_FRAME = Number((/^var RECIPES_PER_FRAME = (\d+);$/m.exec(src) || [])[1]);
const PROPERTY = (/^var RECIPES_HIDDEN_PROPERTY = '([^']+)';$/m.exec(src) || [])[1];
const ok = RULES && CHARACTER && GATE_PARTS.concat(HIDE_PARTS).every(function (p) { return p !== null; }) &&
           PER_FRAME > 0 && !!PROPERTY;
yes('the rules, the character store, the craft gate and the recipe list block are in the gamemode', !!ok);
if (!ok) { done(); }

const tableAt = src.indexOf('  var RECIPES_BY_ID = {');
const tableEnd = tableAt < 0 ? -1 : src.indexOf('\n  };\n', tableAt);
let TABLE = {};
try { TABLE = require('./gamemode-tables.js').inGamemode(src, 'RECIPES_BY_ID'); } catch (e) { TABLE = {}; }
const keptAt = src.indexOf('const KEPT_SMELT = {');
const keptEnd = keptAt < 0 ? -1 : src.indexOf('\n};\n', keptAt);
let KEPT = {};
try { KEPT = JSON.parse(src.slice(keptAt + 'const KEPT_SMELT = '.length, keptEnd + 2)); } catch (e) { KEPT = {}; }
const ALL = Object.assign({}, TABLE, KEPT);
const KEYS = Object.keys(ALL);
const ROW = {
  plateNovice: 'dca04:Skyrim.esm',     // Leather Helmet
  plateAdvanced: 'f6f2a:Skyrim.esm',   // Steel Shin Boots
  edgeNovice: 'da76f:Skyrim.esm',      // Iron Greatsword
  edgeAdvanced: 'a5cd6:Skyrim.esm',    // Steel Greatsword
  cookNovice: 'f4317:Skyrim.esm',      // Venison Stew
  embassy: 'dc9f8:Skyrim.esm',         // Imperial Helmet, the embassy roll's
  dwarvenSmelt: '10dd28:Skyrim.esm'    // the one dwarven smelt that stays
};
const riekling = Object.keys(TABLE).filter(function (k) {
  return TABLE[k].race === 'riekling' && TABLE[k].half === 'Platewright' && TABLE[k].rank === 'novice' && !TABLE[k].nobody;
})[0];
const nobody = Object.keys(TABLE).filter(function (k) { return !!TABLE[k].nobody; })[0];
yes('the rows this test asks about are in the table',
    Object.keys(ROW).every(function (k) { return !!ALL[ROW[k]]; }) && !!riekling && !!nobody &&
    ALL[ROW.plateAdvanced].rank === 'advanced' && ALL[ROW.edgeNovice].half === 'Edgewright' &&
    ALL[ROW.embassy].roll === 'embassy' && Object.keys(KEPT).length === 1);

const RACE_IDS = { 0x13746: 'nordrace', 0x2b51c: 'rieklingrace' };
// The recipes moved in each game (#3120): empty until section E fills it.
const MOVED = {};

function server(store) {
  const sets = [];
  const rolls = { embassy: [] };
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return []; }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    set: function (id, key, value) {
      if (key === PROPERTY) { sets.push(id); }
      (store[id] = store[id] || {})[key] = JSON.stringify(value);
    }
  };
  const ctx = {
    mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
    isFinite: isFinite, parseInt: parseInt,
    console: { log: function () { }, error: function () { } },
    guard: function (name, fn) { return fn; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    notify: function () { }, say: function () { }, log: function () { },
    spellOn: function () { return true; },
    giveTool: function () { return null; },
    RECIPES_BY_ID: TABLE
  };
  // The race off the appearance, the way raceOf reads it on the server.
  ctx.raceOf = function (id) {
    const a = mp.get(id, 'appearance');
    return (a && RACE_IDS[a.raceId]) || '';
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
  // The real gate and the real list block, over the same mp and the same tables.
  const made = new Function('globalThis', 'mp', 'log', 'NO_PROFESSION_AT_A_BENCH', 'RECIPES_BY_ID', 'KEPT_SMELT',
                            'RECIPES_HIDDEN_PROPERTY', 'RECIPES_PER_FRAME', 'raceOf', 'RECIPES_MOVED_IN_GAME',
                            GATE_PARTS.concat(HIDE_PARTS).join('\n') +
                            '\nreturn { craftAnswer: craftAnswer, recipesRefused: recipesRefused, ' +
                            'handRecipesHidden: handRecipesHidden, script: recipesHiddenScript };')(
    ctx, mp, function () { }, 'no profession', TABLE, KEPT, PROPERTY, PER_FRAME, ctx.raceOf, MOVED);
  ctx.__thornswoodRolls = { has: function (id, roll) { return (rolls[roll] || []).indexOf(id) !== -1; } };
  // writeState's typeof finds it here, the way it finds the top level one on the server.
  ctx.handRecipesHidden = made.handRecipesHidden;
  vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  return { ctx: ctx, mp: mp, C: ctx.__thornswoodCharacter, P: ctx.__thornswoodProgression,
           gate: made, sets: sets, rolls: rolls };
}

const store = {};
const srv = server(store);
const P = srv.P;

function person(id, race, prof, half, change) {
  store[id] = store[id] || {};
  store[id].profileId = JSON.stringify(id & 0xfff);
  store[id].appearance = JSON.stringify({ name: 'P' + id.toString(16), raceId: race });
  let s = srv.C.stateOf(id);
  let r = P.pickClass(s, 'miner');
  if (r.ok) { s = r.state; }
  if (prof) {
    r = P.pickProfession(s, prof, half);
    if (r.ok) { s = r.state; }
  }
  if (change) { change(s); }
  srv.C.writeState(id, s);
  return id;
}
function hidden(id) {
  const v = srv.mp.get(id, PROPERTY);
  const out = {};
  if (!v || !v.files) { return out; }
  Object.keys(v.files).forEach(function (f) {
    String(v.files[f]).split(',').forEach(function (h) { if (h) { out[h + ':' + f] = true; } });
  });
  return out;
}
function agrees(id) {
  const h = hidden(id);
  return KEYS.filter(function (k) { return !!h[k] !== !!srv.gate.craftAnswer(id, ALL[k]).refusal; });
}

// ------------------------------------------------- A. what is listed, by whom --
const NONE = person(0xff000201, 0x13746, null, null);
const PLATE = person(0xff000202, 0x13746, 'smith', 'platewright');
const PLATE_ADV = person(0xff000203, 0x13746, 'smith', 'platewright', function (s) { s.ranks.platewright = 'advanced'; });
const RIEK = person(0xff000204, 0x2b51c, 'smith', 'platewright');
const COOK = person(0xff000205, 0x13746, 'cook', 'hearthcook');

{
  const h = hidden(NONE);
  yes('A1: somebody with no profession is handed every row of the table as not listed (' +
      Object.keys(h).length + ' of ' + KEYS.length + ')',
      KEYS.every(function (k) { return h[k]; }));
  const p = hidden(PLATE);
  yes('A2: a novice Platewright sees novice plate, the sister half\'s novice and the dwarven smelt',
      !p[ROW.plateNovice] && !p[ROW.edgeNovice] && !p[ROW.dwarvenSmelt]);
  yes('A2: and not advanced plate, advanced edge work, a cook\'s stew or the embassy\'s helmet',
      p[ROW.plateAdvanced] && p[ROW.edgeAdvanced] && p[ROW.cookNovice] && p[ROW.embassy]);
  yes('A2: nor what nobody makes', p[nobody] && hidden(COOK)[nobody]);
  yes('A3: an advanced Platewright sees advanced plate, and still not advanced edge work',
      !hidden(PLATE_ADV)[ROW.plateAdvanced] && hidden(PLATE_ADV)[ROW.edgeAdvanced]);
  yes('A4: a Riekling\'s own gear is listed for a Riekling smith and not for a Nord one',
      !hidden(RIEK)[riekling] && p[riekling]);
  yes('A5: a cook sees the stew and none of the smith\'s rows',
      !hidden(COOK)[ROW.cookNovice] && hidden(COOK)[ROW.plateNovice] && hidden(COOK)[ROW.dwarvenSmelt]);
  const people = [NONE, PLATE, PLATE_ADV, RIEK, COOK];
  const off = people.map(agrees);
  yes('A6: for every row of the table and every one of them, a row is listed exactly when the craft gate lets them make it' +
      (off.some(function (l) { return l.length; }) ? ' (off: ' + off.map(function (l) { return l.slice(0, 3).join(' '); }).join(' | ') + ')' : ''),
      off.every(function (l) { return l.length === 0; }));
}

// ------------------------------------------------------- B. when it is sent --
{
  srv.sets.length = 0;
  const v1 = srv.mp.get(PLATE, PROPERTY);
  srv.C.writeState(PLATE, srv.C.stateOf(PLATE));
  yes('B1: writing a character whose list did not change sends nothing', srv.sets.length === 0 &&
      srv.mp.get(PLATE, PROPERTY).at === v1.at);
  const s = srv.C.stateOf(PLATE);
  s.ranks.platewright = 'advanced';
  srv.C.writeState(PLATE, s);
  yes('B2: a rank that moves sends the new list once, with a new stamp',
      srv.sets.length === 1 && !hidden(PLATE)[ROW.plateAdvanced] && srv.mp.get(PLATE, PROPERTY).at !== undefined &&
      agrees(PLATE).length === 0);
  srv.sets.length = 0;
  srv.rolls.embassy.push(PLATE);
  srv.gate.handRecipesHidden(PLATE);
  yes('B3: going onto the embassy roll lists the embassy\'s plate', srv.sets.length === 1 && !hidden(PLATE)[ROW.embassy]);
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) { srv.gate.recipesRefused(NONE); }
  const ms = (Date.now() - t0) / 20;
  yes('B4: asking the whole table for one person is cheap enough to do on every write (' + ms.toFixed(2) + ' ms)', ms < 25);
}

// ------------------------------------------------- C. the owner's own game --
{
  // A game with every recipe in the table in it, each on its own bench keyword.
  const records = {};
  KEYS.forEach(function (k, i) { records[k] = { bench: 0x88105 + (i % 3) }; });
  let calls = 0;
  const sp = {
    Game: {
      getFormFromFile: function (id, file) {
        calls++;
        const k = id.toString(16) + ':' + file;
        return records[k] ? { k: k } : null;
      },
      getFormEx: function (id) { return { kw: id }; }
    },
    ConstructibleObject: {
      from: function (form) {
        if (!form) { return null; }
        const r = records[form.k];
        return {
          getWorkbenchKeyword: function () { return r.bench ? { getFormID: function () { return r.bench; } } : null; },
          setWorkbenchKeyword: function (kw) { r.bench = kw ? kw.id : 0; }
        };
      }
    },
    Keyword: { from: function (f) { return f ? { id: f.kw } : null; } }
  };
  const run = new Function('ctx', srv.gate.script());
  const state = {};
  function frame(id) { run({ value: srv.mp.get(id, PROPERTY), state: state, sp: sp }); }
  function frames(id, n) { for (let i = 0; i < n; i++) { frame(id); } }
  const was = {};
  KEYS.forEach(function (k) { was[k] = records[k].bench; });

  frame(NONE);
  const first = KEYS.filter(function (k) { return records[k].bench === 0; }).length;
  yes('C1: a long list is spread over frames: the first frame does ' + PER_FRAME + ' (' + first + ')', first === PER_FRAME);
  frames(NONE, Math.ceil(KEYS.length / PER_FRAME) + 1);
  yes('C2: then nothing of the table is on a bench for somebody with no profession',
      KEYS.every(function (k) { return records[k].bench === 0; }));
  calls = 0;
  frames(NONE, 30);
  yes('C3: the same list on later frames touches no record (updateOwner runs every frame)', calls === 0);

  // The same game, the same session, now the novice Platewright logs in.
  frames(PLATE_ADV, Math.ceil(KEYS.length / PER_FRAME) + 1);
  const h = hidden(PLATE_ADV);
  yes('C4: another character in the same game: what they may make is back on the bench it had, the rest stay off',
      KEYS.every(function (k) { return h[k] ? records[k].bench === 0 : records[k].bench === was[k]; }));
  yes('C4: the advanced plate is at its own bench again', records[ROW.plateAdvanced].bench === was[ROW.plateAdvanced] &&
      records[ROW.cookNovice].bench === 0);

  // A recipe whose record is not in this game is passed over, and the rest still go.
  delete records[ROW.cookNovice];
  frames(COOK, Math.ceil(KEYS.length / PER_FRAME) + 1);
  const hc = hidden(COOK);
  yes('C5: a record this game does not have is passed over and the rest of the list still lands',
      KEYS.every(function (k) { return !records[k] || (hc[k] ? records[k].bench === 0 : records[k].bench === was[k]); }));

  yes('C6: no value, or one that is not a list, touches nothing', (function () {
    calls = 0;
    run({ value: null, state: {}, sp: sp });
    run({ value: 5, state: {}, sp: sp });
    return calls === 0;
  })());
}

// ------------------------------------- E. a recipe moved in each game (#3120) --
{
  // A recipe whose plugin is never copied, moved to its trade's bench in each
  // game: the novice plate, here to a keyword of Thornswood-Content.esp.
  const KW = '154e1:Thornswood-Content.esp';
  MOVED[ROW.plateNovice] = { to: KW };
  srv.sets.length = 0;
  srv.gate.handRecipesHidden(PLATE_ADV);
  const v = srv.mp.get(PLATE_ADV, PROPERTY);
  yes('E1: the moves go out with the list, each to the bench it is made at now',
      srv.sets.length === 1 && !!v.moved && v.moved[ROW.plateNovice] === KW && Object.keys(v.moved).length === 1);
  srv.sets.length = 0;
  srv.gate.handRecipesHidden(PLATE_ADV);
  yes('E1: and the same list with the same moves is not sent again', srv.sets.length === 0);
  srv.gate.handRecipesHidden(NONE);

  const records = {};
  KEYS.forEach(function (k) { records[k] = { bench: 0x88105 }; });
  let calls = 0;
  const sp = {
    Game: {
      getFormFromFile: function (id, file) {
        calls++;
        const k = id.toString(16) + ':' + file;
        if (k === KW) { return { kw: 0x154e1 }; }
        return records[k] ? { k: k } : null;
      },
      getFormEx: function (id) { return { kw: id }; }
    },
    ConstructibleObject: {
      from: function (form) {
        if (!form || !form.k) { return null; }
        const r = records[form.k];
        return {
          getWorkbenchKeyword: function () { return r.bench ? { getFormID: function () { return r.bench; } } : null; },
          setWorkbenchKeyword: function (kw) { r.bench = kw ? kw.id : 0; }
        };
      }
    },
    Keyword: { from: function (f) { return f ? { id: f.kw } : null; } }
  };
  const run = new Function('ctx', srv.gate.script());
  const state = {};
  // Each person's stamp is their own here, so two hands in one millisecond
  // are still two lists.
  function frame(id) { run({ value: Object.assign({}, srv.mp.get(id, PROPERTY), { at: id }), state: state, sp: sp }); }
  function frames(id) { for (let i = 0; i < Math.ceil(KEYS.length / PER_FRAME) + 2; i++) { frame(id); } }

  frames(PLATE_ADV);
  yes('E2: somebody who may make it finds it at its trade\'s bench, and the rest where they were',
      records[ROW.plateNovice].bench === 0x154e1 && records[ROW.plateAdvanced].bench === 0x88105);
  calls = 0;
  for (let i = 0; i < 30; i++) { frame(PLATE_ADV); }
  yes('E3: it is moved once, and later frames touch no record', calls === 0);
  frames(NONE);
  yes('E4: somebody who may not make it does not see it anywhere', records[ROW.plateNovice].bench === 0);
  frames(PLATE_ADV);
  yes('E5: and when it is listed again it goes back to its trade\'s bench, not to the one its mod put it at',
      records[ROW.plateNovice].bench === 0x154e1);
  delete MOVED[ROW.plateNovice];
}

// ------------------------------------------------- D. where it is asked from --
{
  const writeState = between('  function writeState(actorId, s, redraw) {', '\n  }\n');
  yes('D1: writeState hands the list after the character is written',
      !!writeState && writeState.indexOf("mp.set(actorId, CHAR_PROPERTY, s)") < writeState.indexOf('handRecipesHidden(actorId)'));
  const spawn = between('        if (typeof spellOn === \'function\' && spellOn(actorId, staff[j], true)) { put++; }', '    return n;\n  }\n');
  yes('D2: and so does a spawn, which starts from a game whose records list every recipe',
      !!spawn && /handRecipesHidden\(actorId\)/.test(spawn));
  const commit = between('  function commit(roll, list) {', '\n  }\n');
  yes('D3: a roll that changes hands the list to whoever went on or came off',
      !!commit && /handRecipesHidden\(moved\[m\]\)/.test(commit) && commit.indexOf('reg = next;') < commit.indexOf('handRecipesHidden'));
}

done();
