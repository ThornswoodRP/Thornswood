// test-3159-bench-stock.js
//
// #3159. Patrick, 22 Oct: a bench draws materials from chests you own in the
// same building.
//
// The engine half is fork #116: a bench's stock (the craftStock property),
// opened as the person takes the bench, shown in the crafting menu, drawn on
// by the craft after the pack, and named to onCraft as its eighth argument.
// This checks the gamemode's half.
//
// THE NAMING. touchedBench and the stock functions are lifted out of the
// property block and run against a pretend engine: a press on a bench in a
// building the person holds names every container in its cell, nearest
// first, and nothing else; a press by somebody who does not hold it, in a
// lapsed claim, outdoors or on a thing that is not a bench names none. An
// engine with no craftStock is told once in the log. Each chest is brought up
// to date on the dull clock before it is shown.
//
// THE CRAFT. The real mp.onCraft is run as test-1398-fuel.js runs it, with a
// stock: charcoal and a handle the pack lacks come out of the chest, the pack
// is used first when it has them, and a craft that draws on chests that are no
// longer the person's is refused with nothing taken.
//
// Read only. Prints PASS and FAIL lines, exit 1 when anything fails.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.stack ? e.stack : e), false); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function cut(head) { return slice(gm, head, '\n}\n'); }
function cutInner(head) { return slice(gm, '  ' + head, '\n  }\n'); }
function lineOf(re) { const m = re.exec(gm); return m ? m[0] : null; }

// ------------------------------------------------------------- 1. the naming
const naming = {
  touched: cutInner('function touchedBench(actorId, baseDesc, refrId) {'),
  stockFor: cutInner('function stockFor(actorId, benchId) {'),
  name: cutInner('function nameBenchStock(actorId, benchId) {'),
  benchStock: cutInner('function benchStock(actorId, benchId, draws) {'),
  prop: lineOf(/^  var STOCK_PROPERTY = .*$/m)
};
yes('the naming pieces are in the property block',
    Object.keys(naming).every(function (k) { return !!naming[k]; }));
yes('the property block hands benchStock out', /benchStock: benchStock,/.test(gm));
yes('the property is the one the fork reads', naming.prop === "  var STOCK_PROPERTY = 'craftStock';");

const HOUSE = '165a7:Skyrim.esm';     // a building's cell
const OTHER = '165a8:Skyrim.esm';     // the next room, another cell
const OUTSIDE = '3c:Skyrim.esm';      // Tamriel
const FORGE_BASE = '88105:Skyrim.esm', CHEST_BASE = 'a0:Skyrim.esm', BARREL_BASE = 'a1:Skyrim.esm', ROCK_BASE = 'a2:Skyrim.esm';
const ME = 0xff000001, YOU = 0xff000002;
const BENCH = 0x1000, NEAR_CHEST = 0x1001, FAR_BARREL = 0x1002, ROCK = 0x1003, NEXT_ROOM = 0x1004, YARD_FORGE = 0x1005;

function world(opts) {
  opts = opts || {};
  const E = {
    cell: {}, pos: {}, base: {}, props: {}, logs: [], opened: [],
    profile: {}, claims: opts.claims || {}
  };
  E.cell[BENCH] = HOUSE; E.pos[BENCH] = [100, 100, 0]; E.base[BENCH] = FORGE_BASE;
  E.cell[NEAR_CHEST] = HOUSE; E.pos[NEAR_CHEST] = [150, 100, 0]; E.base[NEAR_CHEST] = CHEST_BASE;
  E.cell[FAR_BARREL] = HOUSE; E.pos[FAR_BARREL] = [900, 100, 0]; E.base[FAR_BARREL] = BARREL_BASE;
  E.cell[ROCK] = HOUSE; E.pos[ROCK] = [120, 100, 0]; E.base[ROCK] = ROCK_BASE;
  E.cell[NEXT_ROOM] = OTHER; E.pos[NEXT_ROOM] = [110, 100, 0]; E.base[NEXT_ROOM] = CHEST_BASE;
  E.cell[YARD_FORGE] = OUTSIDE; E.pos[YARD_FORGE] = [100, 100, 0]; E.base[YARD_FORGE] = FORGE_BASE;
  E.cell[ME] = HOUSE; E.pos[ME] = [100, 90, 0];
  E.cell[YOU] = HOUSE; E.pos[YOU] = [100, 80, 0];
  E.profile[ME] = 7; E.profile[YOU] = 8;
  E.mp = {
    get: function (id, key) {
      if (key === 'worldOrCellDesc') { return E.cell[id]; }
      if (key === 'pos') { return E.pos[id]; }
      if (key === 'baseDesc') { return E.base[id]; }
      if (key === 'profileId') { return E.profile[id]; }
      return E.props[id + '.' + key];
    },
    set: function (id, key, v) {
      if (key === 'craftStock' && opts.oldEngine) { throw new Error('no property craftStock'); }
      E.props[id + '.' + key] = v === null ? null : JSON.parse(JSON.stringify(v));
    },
    // The fork's answer: everything in the nine squares around a position in
    // that cell or world, with the empty slots a server before #529 put first.
    getNeighborsByPosition: function (cellDesc, pos) {
      if (typeof cellDesc !== 'string' || !Array.isArray(pos)) { throw new Error('bad arguments'); }
      const cx = Math.trunc(pos[0] / 4096), cy = Math.trunc(pos[1] / 4096);
      const found = [];
      Object.keys(E.cell).forEach(function (k) {
        const id = Number(k);
        if (E.cell[id] !== cellDesc) { return; }
        const x = Math.trunc(E.pos[id][0] / 4096), y = Math.trunc(E.pos[id][1] / 4096);
        if (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1) { found.push(id); }
      });
      return found;
    }
  };
  const body = [
    'var BENCH_BY_BASE = {}; BENCH_BY_BASE[' + JSON.stringify(FORGE_BASE) + '] = ' + JSON.stringify(FORGE_BASE) + ';',
    "var BENCH_PROPERTY = 'thornswoodBench';",
    naming.prop,
    'var stockWarned = false;',
    'function plog() { E.logs.push(Array.prototype.slice.call(arguments).join(" ")); }',
    'function holderOf(building) { return Object.prototype.hasOwnProperty.call(claims, building) ? claims[building] : null; }',
    'function kindIsContainer(baseDesc) { return baseDesc === ' + JSON.stringify(CHEST_BASE) + ' || baseDesc === ' + JSON.stringify(BARREL_BASE) + '; }',
    naming.touched, naming.stockFor, naming.name, naming.benchStock,
    'return { touchedBench: touchedBench, benchStock: benchStock };'
  ].join('\n');
  const g = {
    __thornswoodDurability: opts.noClock ? undefined : { opened: function (id) { E.opened.push(id); return 0; } }
  };
  E.api = new Function('mp', 'claims', 'g', 'E', body)(E.mp, E.claims, g, E);
  E.stock = function (id) { return E.props[id + '.craftStock']; };
  return E;
}

if (Object.keys(naming).every(function (k) { return !!naming[k]; })) {
  attempt('the holder at a bench in their building', function () {
    const E = world({ claims: { '165a7:Skyrim.esm': { by: 7, name: 'Ysolda' } } });
    E.api.touchedBench(ME, FORGE_BASE, BENCH);
    const s = E.stock(ME);
    yes('names the bench and every container in its cell, the nearest first',
        !!s && s.bench === BENCH && JSON.stringify(s.from) === JSON.stringify([NEAR_CHEST, FAR_BARREL]));
    yes('names no rock, nobody, and no chest in the next room', s && s.from.indexOf(ROCK) === -1 &&
        s.from.indexOf(ME) === -1 && s.from.indexOf(NEXT_ROOM) === -1 && s.from.indexOf(BENCH) === -1);
    yes('brings each chest up to date on the dull clock first',
        JSON.stringify(E.opened) === JSON.stringify([NEAR_CHEST, FAR_BARREL]));
    yes('still writes down which bench it was, for /key', !!E.props[ME + '.thornswoodBench']);

    E.props[ME + '.craftStock'].open = true;
    const at = E.api.benchStock(ME, BENCH, [{ baseId: 1, count: 1, from: NEAR_CHEST }]);
    yes('at the craft, the open stock is theirs to draw on',
        !at.refusal && JSON.stringify(at.from) === JSON.stringify([NEAR_CHEST, FAR_BARREL]));
    yes('at another bench it gives nothing', E.api.benchStock(ME, YARD_FORGE, []).from.length === 0);
    E.props[ME + '.craftStock'].open = false;
    yes('named but not open, it gives nothing', E.api.benchStock(ME, BENCH, []).from.length === 0);

    E.api.touchedBench(ME, ROCK_BASE, ROCK);
    yes('a press on something that is not a bench leaves it alone', !!E.stock(ME));
  });

  attempt('somebody who does not hold it', function () {
    const E = world({ claims: { '165a7:Skyrim.esm': { by: 7, name: 'Ysolda' } } });
    E.api.touchedBench(YOU, FORGE_BASE, BENCH);
    yes('a guest or a partner at the holder\'s bench gets the pack alone', E.stock(YOU) === null);
    yes('and no chest is opened for them', E.opened.length === 0);
  });

  attempt('no claim, and outdoors', function () {
    const E = world({ claims: {} });
    E.api.touchedBench(ME, FORGE_BASE, BENCH);
    yes('a building nobody holds (or a claim that lapsed) names none', E.stock(ME) === null);
    // A claim is a building's cell, so a forge in the yard is in none, with
    // a chest beside it and the house behind it held by the same person.
    const F = world({ claims: { '165a7:Skyrim.esm': { by: 7, name: 'Ysolda' } } });
    F.cell[0x1006] = OUTSIDE; F.pos[0x1006] = [120, 100, 0]; F.base[0x1006] = CHEST_BASE;
    F.api.touchedBench(ME, FORGE_BASE, YARD_FORGE);
    yes('a bench outdoors is in no building of theirs', F.stock(ME) === null);
  });

  attempt('the building changes hands while they stand at the bench', function () {
    const E = world({ claims: { '165a7:Skyrim.esm': { by: 7, name: 'Ysolda' } } });
    E.api.touchedBench(ME, FORGE_BASE, BENCH);
    E.props[ME + '.craftStock'].open = true;
    E.claims[HOUSE] = { by: 8, name: 'Brenuin' };
    const drawing = E.api.benchStock(ME, BENCH, [{ baseId: 1, count: 2, from: NEAR_CHEST }]);
    yes('a craft that draws on the chests is refused, and says why',
        /not yours any more/.test(drawing.refusal) && drawing.from.length === 0);
    yes('and the stock is taken away there and then', E.stock(ME) === null);

    E.props[ME + '.craftStock'] = { bench: BENCH, from: [NEAR_CHEST], open: true };
    const packOnly = E.api.benchStock(ME, BENCH, []);
    yes('one the pack gives in full goes on with the pack alone',
        !packOnly.refusal && packOnly.from.length === 0 && E.stock(ME) === null);
  });

  attempt('an engine before fork #116', function () {
    const E = world({ claims: { '165a7:Skyrim.esm': { by: 7, name: 'Ysolda' } }, oldEngine: true });
    E.api.touchedBench(ME, FORGE_BASE, BENCH);
    E.api.touchedBench(ME, FORGE_BASE, BENCH);
    yes('the press goes on, and the log says so once',
        E.logs.length === 1 && /craftStock/.test(E.logs[0]) && !!E.props[ME + '.thornswoodBench']);
    yes('a craft there draws on nothing', E.api.benchStock(ME, BENCH, []).from.length === 0);
  });

  attempt('no dull clock loaded', function () {
    const E = world({ claims: { '165a7:Skyrim.esm': { by: 7, name: 'Ysolda' } }, noClock: true });
    E.api.touchedBench(ME, FORGE_BASE, BENCH);
    yes('the chests are still named', !!E.stock(ME) && E.stock(ME).from.length === 2);
  });
}

// --------------------------------------------------------------- 2. the craft
const recSrc = slice(gm, 'var RECIPES_BY_ID = {', ';\n');
let RECIPES = null;
try { RECIPES = new Function('return ' + recSrc.slice('var RECIPES_BY_ID = '.length).replace(/;$/, ''))(); } catch (e) { RECIPES = null; }
const keptSrc = slice(gm, 'const KEPT_SMELT = {', '\n};');
let KEPT = null;
try { KEPT = new Function('return ' + keptSrc.slice('const KEPT_SMELT = '.length).replace(/;$/, ''))(); } catch (e) { KEPT = null; }
const fuelLine = /^const FUEL_BY_RECIPE = (\{.*\});$/m.exec(gm);
const ITEMS = JSON.parse(/^const ITEMS = (\{.*\});$/m.exec(gm)[1]);
const progression = slice(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const box = { console: { log: function () {} } };
box.globalThis = box;
vm.runInNewContext(progression, box);
const P = box.__thornswoodProgression;
function byName(name) {
  for (const k of Object.keys(RECIPES)) { if (RECIPES[k].name === name && !RECIPES[k].nobody) { return k; } }
  return null;
}
const pieces = {
  grades: slice(gm, 'const CHARCOAL_GRADES = [', '\n];'),
  hafted: lineOf(/^const HAFTED_FAMILIES = .*$/m),
  handle: lineOf(/^const HANDLE_DESC = .*$/m),
  tools: slice(gm, 'const TOOLS = {', '\n};'),
  key: lineOf(/^const KEY_RECIPE = .*$/m),
  // #3151: the quality a weapon or an armour piece comes out at, which onCraft
  // names, as test-1398-fuel.js lifts it.
  quality: [slice(gm, 'const CRAFT_QUALITY = {', '\n};'), lineOf(/^const QUALITY_WEAPON_FAMILIES = .*$/m),
            lineOf(/^const QUALITY_RANKS = .*$/m)].join('\n'),
  fns: ['function idOf(descriptor)', 'function mintedEntry(entry)', 'function takeItem(actorId, itemDesc, count)', 'function addItem(actorId, itemDesc, count)',
        'function craftRow(recipeDesc)', 'function fuelFor(recipeDesc)', 'function packCount(actorId, itemDesc)',
        'function charcoalHeld(actorId, grade)', 'function fuelRefusal(fuel)', 'function wantsAHandle(row)',
        'function holdsPerk(actorId, key)', 'function wovenMark(actorId)',
        'function wovenOutput(actorId, row)', 'function cookedOutput(actorId, row)',
        'function qualityTier(margin, roll)', 'function qualityRolled(row, baseId)',
        'function qualityMargin(actorId, row)', 'function qualityOutput(actorId, row, margin)',
        // A dish named with its days left (#3163), after the other outputs.
        'function spoilingOutput(actorId)',
        'function unfitToMake(actorId, workbenchId)'].map(cut),
  onCraft: slice(gm, "mp.onCraft = guard('onCraft', function (actorId, craftedItemBaseId, count, recipeId, workbenchId, effects) {", '\n});\n')
};
const craftReady = !!RECIPES && !!KEPT && !!fuelLine && !!P && !!pieces.grades && !!pieces.hafted && !!pieces.handle &&
  !!pieces.tools && !!pieces.key && !!pieces.quality && pieces.fns.every(function (f) { return !!f; }) && !!pieces.onCraft;
yes('the craft pieces are all in the gamemode', craftReady);
yes('onCraft asks the property block for the stock with the eighth argument',
    !!pieces.onCraft && /benchStock\(actorId, workbenchId, arguments\[7\]\)/.test(pieces.onCraft));

const CHEST = 0x2001, BENCH_REF = 0x2000;

/*
  The rig of test-1398-fuel.js, with a chest. Every reference has a pack, the
  chest's is what mp.get(chest, 'inventory') reads, and the property block's
  benchStock is a stand-in that answers what the test says.
*/
function craftRig(state, stockAnswer) {
  const ids = {}, descs = {};
  let next = 0x100;
  function id(desc) { if (!ids[desc]) { ids[desc] = next; descs[next] = desc; next++; } return ids[desc]; }
  const packs = {};
  const said = [];
  const asked = [];
  let output = null;
  const mp = {
    getIdFromDesc: function (d) { return id(d); },
    getDescFromId: function (n) { return descs[n] || ''; },
    get: function (a, key) {
      if (key === 'inventory') { return { entries: (packs[a] || []).map(function (e) { return Object.assign({}, e); }) }; }
      if (key === 'craftOutput') { return output ? Object.assign({}, output) : undefined; }
      return undefined;
    },
    set: function (a, key, v) {
      if (key === 'inventory') { packs[a] = v.entries.map(function (e) { return Object.assign({}, e); }); }
      if (key === 'craftOutput' && output) { output = Object.assign({}, output, v); }
    },
    onCraft: null
  };
  const g = {
    __thornswoodProgression: P,
    __thornswoodCharacter: { stateOf: function () { return state; }, weaveOf: function () { return ''; } },
    __thornswoodNeeds: { NEEDS: { wear: { woven: { degrees: 4, mark: 'Master-Woven ' } } } },
    __thornswoodManeuvers: { WOVEN: { mark: 'Master-Lined ', less: 0.1 } },
    __thornswoodProperty: {
      benchStock: function (actorId, benchId, draws) {
        asked.push({ actorId: actorId, benchId: benchId, draws: draws });
        return stockAnswer;
      }
    }
  };
  const body = [pieces.grades, fuelLine[0], pieces.hafted, pieces.handle, pieces.tools, pieces.key, pieces.quality]
    .concat(pieces.fns).join('\n') + '\n' + pieces.onCraft + '\nreturn mp.onCraft;';
  const onCraft = new Function('mp', 'globalThis', 'ITEMS', 'RECIPES_BY_ID', 'KEPT_SMELT', 'guard', 'notify', 'say', 'log',
    'setTimeout', 'recipelessCraft', 'craftAnswer', 'creditWork',
    // The trade's tool (#3162): the crafter holds it, so the craft goes on to the
    // chests this harness checks. test-3162-bench-tools holds the refusal and the wear.
    'benchToolKey', 'toolGate', 'toolFor', 'wearTool', body)(
    mp, g, ITEMS, RECIPES, KEPT, function (n, f) { return f; }, function () {},
    function (a, t) { said.push(t); }, function () {},
    function () { return 0; }, function () { return undefined; },
    function () { return { refusal: null, note: null, credit: '' }; },
    function () { return ''; },
    function () { return 'smith'; }, function () { return null; }, function () { return { name: 'hammer' }; }, function () { return null; });
  const A = 0xff000001;
  function count(holder, desc) {
    return (packs[holder] || []).filter(function (e) { return e.baseId === id(desc); }).reduce(function (t, e) { return t + e.count; }, 0);
  }
  return {
    A: A, said: said, asked: asked,
    give: function (holder, desc, n) { (packs[holder] = packs[holder] || []).push({ baseId: id(desc), count: n }); },
    count: count,
    craft: function (recipe, draws) {
      const row = RECIPES[recipe] || KEPT[recipe];
      output = { baseId: id(row.out), count: 1 };
      const r = onCraft(A, id(row.out), 1, id(recipe), BENCH_REF, null, [], draws || []);
      output = null;
      return r;
    }
  };
}

if (craftReady) {
  const smith = P.pickProfession(P.fresh(), 'smith', 'edgewright').state;
  smith.ranks.edgewright = 'master';
  const T1 = ITEMS.charcoalT1;
  const HANDLE = /'([^']+)'/.exec(pieces.handle)[1];
  const sword = byName('Iron Sword'), axe = byName('Iron War Axe');
  const theirs = { from: [CHEST], refusal: '' };

  attempt('charcoal from the chest', function () {
    const r = craftRig(smith, theirs);
    r.give(CHEST, T1, 2);
    yes('with no charcoal in the pack, the forge burns one from the chest',
        r.craft(sword) !== false && r.count(CHEST, T1) === 1 && r.count(r.A, T1) === 0);
    yes('the property block was asked for this bench, with the eighth argument',
        r.asked.length === 1 && r.asked[0].benchId === BENCH_REF && Array.isArray(r.asked[0].draws));
    r.give(r.A, T1, 1);
    yes('with some in the pack, the pack burns first',
        r.craft(sword) !== false && r.count(r.A, T1) === 0 && r.count(CHEST, T1) === 1);
  });

  attempt('a handle from the chest', function () {
    const r = craftRig(smith, theirs);
    r.give(r.A, T1, 1); r.give(CHEST, HANDLE, 1);
    yes('a war axe takes its handle from the chest when the pack has none',
        r.craft(axe) !== false && r.count(CHEST, HANDLE) === 0 && r.count(r.A, T1) === 0);
    r.give(r.A, T1, 1);
    yes('with no handle in either, it is refused and the charcoal stays',
        r.craft(axe) === false && r.count(r.A, T1) === 1 && /fitted to a wooden handle/.test(r.said.join(' ')));
  });

  attempt('no stock', function () {
    const r = craftRig(smith, { from: [], refusal: '' });
    r.give(CHEST, T1, 2);
    yes('a bench with no chests of theirs does not reach into one',
        r.craft(sword) === false && r.count(CHEST, T1) === 2 && /you have none/.test(r.said.join(' ')));
  });

  attempt('chests that are not theirs any more', function () {
    const r = craftRig(smith, { from: [], refusal: 'The chests here are not yours any more, so the bench has only what you carry.' });
    r.give(r.A, T1, 1);
    yes('the craft is refused, says why, and nothing is taken',
        r.craft(sword, [{ baseId: 1, count: 1, from: CHEST }]) === false && r.count(r.A, T1) === 1 &&
        /not yours any more/.test(r.said.join(' ')));
  });
}

// ------------------------------------------------------------ 3. the records
const doc = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'property.md'), 'utf8').split(CR).join('');
yes('the property rules say a bench draws from the chests', /bench[^.]*draws?[^.]*chests?/i.test(doc));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
