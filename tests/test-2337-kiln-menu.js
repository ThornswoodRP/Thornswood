// test-2337-kiln-menu.js
//
// #2337: a press on the charcoal kiln is the engine's, so the kiln's crafting
// menu opens and the Tool Handle, the Splint and the four charcoal grades are
// made in it, and no press spends firewood by itself.
//
// Until 12 Oct onActivate answered every kiln press with burnCharcoal: the
// first press said what three firewood would make and answered false, the
// second inside fifteen seconds took the firewood and handed over charcoal,
// and answered false. A false skips ProcessActivateNormal, the engine step
// that seats somebody at a FURN and opens its menu for them. The menu was
// the end state the old code's own comment named once the charcoal recipes
// existed, and they do.
//
// What this proves, against the real text of game/gamemode.js (or the file in
// GM, which is how the old behaviour is measured: GM=<old gamemode.js>):
//   - the real onActivate, pressed twice on a kiln by a charburner carrying
//     firewood, answers undefined both times, which hands the press to the
//     engine (seat and menu), takes nothing, gives nothing and says nothing;
//   - the same press by somebody the bench is not for is still refused by
//     benchGate before anything else, with false and the line;
//   - nothing in the gamemode answers the kiln any more: no burnCharcoal, no
//     armed window, and the kiln is off the list of bases the server answers;
//   - the plugin's six kiln recipes are on the kiln's keyword in recipes.json
//     and in the server's own recipe table at the ranks the charburner page
//     gives, and the real craft gate lets a novice charburner make the handle
//     and poor charcoal, a novice woodwright the splint, and refuses a novice
//     coke, so the menu is graded by the rank the press used to grade by.

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
function take(start, end) {
  const i = src.indexOf(start);
  const j = i < 0 ? -1 : src.indexOf(end || '\n}\n', i);
  return (i >= 0 && j >= 0) ? src.slice(i, j + (end || '\n}\n').length) : null;
}
function between(a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j) : null;
}

const KILN_BASE = '1547e:Thornswood-Content.esp';
const KILN_KEYWORD = '1547f:Thornswood-Content.esp';
const FIREWOOD = '6f993:Skyrim.esm';

const stationsLine = /^const STATIONS = (\{.*\});$/m.exec(src);
const STATIONS = stationsLine ? JSON.parse(stationsLine[1]) : null;
yes('STATIONS still names the kiln base the plugin places', !!STATIONS && STATIONS.charcoalKiln === KILN_BASE);

const HANDLER_HEAD = "mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {";
const handlerAt = src.indexOf(HANDLER_HEAD);
const handlerEnd = handlerAt < 0 ? -1 : src.indexOf('\n});\n', handlerAt);
const handler = (handlerAt >= 0 && handlerEnd >= 0)
  ? src.slice(handlerAt + "mp.onActivate = guard('onActivate', ".length, handlerEnd + 2) : null;
yes('onActivate is in the gamemode', !!handler);
if (!handler || !STATIONS) { done(); }

// The old kiln, when the file under test still has it, so GM=<old file> runs
// the press as it was and this harness says what it did.
const oldKiln = take('function burnCharcoal(actorId, refrId) {');

// --------------------------------------------------------------- the press --
const CHARBURNER = 0xff000101, STRANGER = 0xff000102;
const KILN_REF = 0x00ab0001;

function world() {
  const rec = { told: [], taken: [], given: [], branch: [] };
  const firewood = {};
  firewood[CHARBURNER] = 6;
  firewood[STRANGER] = 6;
  const bases = {};
  bases[KILN_REF] = KILN_BASE;
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
  const benchGate = function (actorId, baseDesc) {
    if (baseDesc === KILN_BASE && actorId === STRANGER) {
      return 'There is nothing you can make here. That bench is Charburner\'s.';
    }
    return null;
  };
  const never = function () { return false; };
  const nothing = function () { return null; };
  const tag = function (name) { return function () { rec.branch.push(name); return 'answered by ' + name; }; };
  const ITEMS = { firewood: FIREWOOD, charcoalT1: 'c1', charcoalT2: 'c2', charcoalT3: 'c3', charcoalT4: 'c4' };
  const takeItem = function (actorId, desc, n) {
    if (desc !== FIREWOOD || firewood[actorId] < n) { return false; }
    firewood[actorId] -= n;
    rec.taken.push({ actorId: actorId, desc: desc, n: n });
    return true;
  };
  const addItem = function (actorId, desc, n) { rec.given.push({ actorId: actorId, desc: desc, n: n }); return true; };

  let burn = null;
  if (oldKiln) {
    burn = new Function('halfGate', 'toolGate', 'unfitToMake', 'cooldownLeft', 'rankStep', 'takeItem',
      'addItem', 'ITEMS', 'stampCooldown', 'creditWork', 'wearTool', 'KILN_ARMED', 'KILN_ARM_MS',
      oldKiln + '\nreturn burnCharcoal;')(
      nothing, nothing, function () { return ''; }, function () { return 0; }, function () { return 0; },
      takeItem, addItem, ITEMS, function () { }, nothing, nothing, {}, 15000);
  }

  const names = ['benchGate', 'notify', 'say', 'globalThis', 'mp', 'noteCameIn', 'log',
    'kindIsContainer', 'STATIONS', 'mineSalt', 'burnCharcoal', 'isChoppingBlock', 'chopWood',
    'SHRINES', 'bless', 'isCrop', 'farmActivate', 'isFish', 'fish', 'ALLOW', 'floraHanded',
    'putBack', 'isGame', 'game', 'isChickenNest', 'collectEgg', 'isChurn', 'churn', 'isHive',
    'hive', 'isPlant', 'harvest', 'isVein', 'mineOre', 'milk', 'loot',
    'isWorldProduce', 'worldProduce'];
  const onActivate = new Function(names.join(','), "'use strict';\nreturn " + handler + ';').apply(null, [
    benchGate,
    function (id, text) { rec.told.push(text); },
    function () { },
    {},
    mp, function () { }, function () { },
    never, STATIONS, tag('mineSalt'), burn || tag('burnCharcoal'), never, tag('chopWood'),
    {}, tag('bless'), never, tag('farmActivate'), never, tag('fish'), { thornswoodAllow: true },
    never, function () { }, never, tag('game'), never, tag('collectEgg'), never, tag('churn'),
    never, tag('hive'), never, tag('harvest'), never, tag('mineOre'), nothing,
    function () { rec.branch.push('loot'); return null; },
    never, tag('worldProduce')]);
  return { onActivate: onActivate, rec: rec, firewood: firewood };
}

function engine(answer) {
  return answer === false
    ? 'blocked: ProcessActivateNormal is skipped, the server seats nobody and opens nothing'
    : 'goes on: ProcessActivateNormal seats them at the kiln and opens its menu';
}

{
  const w = world();
  const first = w.onActivate(KILN_REF, CHARBURNER);
  const told1 = w.rec.told.slice();
  const second = w.onActivate(KILN_REF, CHARBURNER);
  console.log('      first press: ' + engine(first) + (told1.length ? '; told "' + told1.join(' ') + '"' : ''));
  console.log('      second press: ' + engine(second) +
              (w.rec.told.length > told1.length ? '; told "' + w.rec.told.slice(told1.length).join(' ') + '"' : '') +
              '; firewood left ' + w.firewood[CHARBURNER] + ' of 6');
  yes('a charburner\'s first press on the kiln goes on to the engine, so the menu opens', first === undefined);
  yes('and so does the second, inside what used to be the burn window', second === undefined);
  yes('two presses take no firewood and hand over no charcoal',
      w.firewood[CHARBURNER] === 6 && w.rec.taken.length === 0 && w.rec.given.length === 0);
  yes('and nothing is said over the menu', w.rec.told.length === 0);
  yes('the press reaches no answering branch, the same as every other bench',
      w.rec.branch.join() === 'loot,loot');
}

{
  const w = world();
  const shut = w.onActivate(KILN_REF, STRANGER);
  yes('somebody the kiln is not for is still refused by the bench gate, with false and the line',
      shut === false && w.rec.told.length === 1 && /nothing you can make here/.test(w.rec.told[0]));
  yes('and loses nothing', w.firewood[STRANGER] === 6 && w.rec.taken.length === 0);
}

// ------------------------------------------------- nothing answers the kiln --
yes('there is no burnCharcoal and no armed window in the gamemode',
    !/function burnCharcoal\b/.test(src) && src.indexOf('KILN_ARMED') < 0 && src.indexOf('KILN_ARM_MS') < 0);
yes('onActivate has no kiln branch', handler.indexOf('charcoalKiln') < 0);
const basesList = take('(function publishServerBases() {', '\n})();\n');
yes('the kiln is off the list of bases the server answers', !!basesList && basesList.indexOf('charcoalKiln') < 0);

// ------------------------------------------------------- the menu has rows --
const KILN_ROWS = {
  '15480:Thornswood-Content.esp': { name: 'Poor Charcoal', half: 'Charburner', rank: 'novice' },
  '15486:Thornswood-Content.esp': { name: 'Charcoal', half: 'Charburner', rank: 'advanced' },
  '15487:Thornswood-Content.esp': { name: 'Charcoal Briquette', half: 'Charburner', rank: 'expert' },
  '15488:Thornswood-Content.esp': { name: 'Coke', half: 'Charburner', rank: 'master' },
  '15491:Thornswood-Content.esp': { name: 'Tool Handle', half: 'Charburner', rank: 'novice' },
  '154c5:Thornswood-Content.esp': { name: 'Splint', half: 'Woodwright', rank: 'novice' }
};
const recipes = JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'recipes.json'), 'utf8'));
const recipeRows = recipes.recipes || recipes;
const onKiln = Object.keys(KILN_ROWS).filter(function (id) {
  const r = recipeRows[id];
  return r && r.bench === KILN_KEYWORD && r.name === KILN_ROWS[id].name &&
    r.half === KILN_ROWS[id].half && r.rank === KILN_ROWS[id].rank;
});
yes('recipes.json puts all six on the kiln\'s keyword at the charburner page\'s ranks (' + onKiln.length + ' of 6)',
    onKiln.length === 6);
const kilnFirewood = ['15480', '15486', '15487', '15488'].map(function (id) {
  const r = recipeRows[id + ':Thornswood-Content.esp'];
  const f = r && (r.inputItems || []).filter(function (x) { return x.item === FIREWOOD; })[0];
  return f ? f.count : 0;
});
yes('the four charcoal grades cost 2, 4, 7 and 12 firewood, as the charburner page says',
    kilnFirewood.join() === '2,4,7,12');

const tableAt = src.indexOf('  var RECIPES_BY_ID = {');
const tableEnd = tableAt < 0 ? -1 : src.indexOf('\n  };\n', tableAt);
let TABLE = {};
try { TABLE = require('./gamemode-tables.js').inGamemode(src, 'RECIPES_BY_ID'); } catch (e) { TABLE = {}; }
const inTable = Object.keys(KILN_ROWS).filter(function (id) {
  const r = TABLE[id];
  return r && r.name === KILN_ROWS[id].name && r.half === KILN_ROWS[id].half && r.rank === KILN_ROWS[id].rank;
});
yes('the server\'s own recipe table has the same six rows (' + inTable.length + ' of 6)', inTable.length === 6);

// ------------------------------------------- the real craft gate grades it --
const RULES = between('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between('// ==== thornswood character ====', '// ==== end thornswood character ====');
const GATE_PARTS = [
  take('function craftAnswer(actorId, row) {'),
  take('function raceGate(actorId, row) {'),
  take('var RACE_CALLED = {', '\n};\n'),
  take('function professionName(prof) {'),
  take('function aWord(name) {'),
  take('function rankWord(rank) {')
];
const gateOk = RULES && CHARACTER && GATE_PARTS.every(function (p) { return p !== null; });
yes('the rules, the character store and the craft gate are in the gamemode', !!gateOk);
if (!gateOk) { done(); }

const store = {};
const mp2 = {
  makeProperty: function () { },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return []; }
    const p = store[id] || {};
    return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
  },
  set: function (id, key, value) { (store[id] = store[id] || {})[key] = JSON.stringify(value); }
};
const ctx = {
  mp: mp2, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
  isFinite: isFinite, parseInt: parseInt,
  console: { log: function () { }, error: function () { } },
  guard: function (name, fn) { return fn; },
  setInterval: function () { return 1; }, clearInterval: function () { },
  notify: function () { }, say: function () { }, log: function () { },
  spellOn: function () { return true; }, giveTool: function () { return null; },
  raceOf: function () { return ''; }, RECIPES_BY_ID: TABLE
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
const craftAnswer = new Function('globalThis', 'log', 'raceOf', 'NO_PROFESSION_AT_A_BENCH',
  GATE_PARTS.join('\n') + '\nreturn craftAnswer;')(ctx, function () { }, function () { return ''; }, 'no profession');
const C = ctx.__thornswoodCharacter, P = ctx.__thornswoodProgression;

function woodworker(id, half) {
  store[id] = { profileId: JSON.stringify(id & 0xffff), appearance: JSON.stringify({ name: 'W' + id }) };
  let s = C.stateOf(id);
  let r = P.pickClass(s, 'gatherer');
  if (r.ok) { s = r.state; }
  r = P.pickProfession(s, 'woodworker', half);
  if (r.ok) { s = r.state; }
  C.writeState(id, s);
  return id;
}
const BURNER = woodworker(0xff000201, 'charburner');
const WRIGHT = woodworker(0xff000202, 'woodwright');
function may(id, recipe) { const a = craftAnswer(id, TABLE[recipe]); return !a.refusal; }

yes('a novice charburner may make the Tool Handle at the kiln', may(BURNER, '15491:Thornswood-Content.esp'));
yes('and Poor Charcoal', may(BURNER, '15480:Thornswood-Content.esp'));
yes('but not Coke, which is master work, so the grade still follows the rank',
    !may(BURNER, '15488:Thornswood-Content.esp'));
yes('a novice woodwright may make the Splint at the kiln', may(WRIGHT, '154c5:Thornswood-Content.esp'));

done();
