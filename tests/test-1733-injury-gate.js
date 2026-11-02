// test-1733-injury-gate.js
//
// #1733. injury.md and disease.md: a broken arm or a missing hand refuses
// the work that takes two hands, the forges and the kiln among it, and a
// disease gone bad refuses every craft. That was asked only at a bench's own
// menu (mp.onCraft). A key cut at a forge with the lock key and a kiln burned
// by pressing it asked the rest gate alone (#1676), so somebody refused the
// forge's own Key row for a broken arm cut the same key at the same forge.
// The kiln's press is gone since #2337: its charcoal is made in its own menu.
//
// Now every way of making something asks one gate, unfitToMake, which asks
// the injury and disease block and then the needs block. This drives the
// REAL injury and disease block, the REAL needs block, the REAL gate and the
// two roads as they stand in the gamemode (mp.onCraft, at the forge and at
// the kiln, and the property block's cutKey with forgeHere, atForge and
// touchedBench) over
// one fake mp and one clock, and holds the rest of the file to the one gate,
// so a road added later cannot ask one gate and forget the other.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const SRC = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(start, end) {
  const a = gm.indexOf(start);
  if (a < 0) { return null; }
  const b = gm.indexOf(end, a + start.length);
  return b < 0 ? null : gm.slice(a, b + end.length);
}
function table(name) {
  const m = new RegExp('^const ' + name + ' = (\\{.*\\});$', 'm').exec(gm);
  return m ? JSON.parse(m[1]) : null;
}
function number(name) {
  const m = new RegExp('^  var ' + name + ' = (\\d+);', 'm').exec(gm);
  return m ? Number(m[1]) : NaN;
}

const NEEDS_SRC = slice('// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const HURT_SRC = slice('// ==== thornswood injury and disease ====', '// ==== end thornswood injury and disease ====');
const GATE_SRC = slice('function unfitToMake(actorId, workbenchId) {', '\n}\n');
const CRAFT_SRC = slice("mp.onCraft = guard('onCraft', function (actorId, craftedItemBaseId, count, recipeId, workbenchId, effects) {", '\n});\n');
// The order taken at a bench before its time runs (#3161) asks it too, so a
// person too tired to work is told before they wait.
const WORK_SRC = slice("mp.onCraftWork = guard('onCraftWork', function (actorId, craftedItemBaseId, count, recipeId, workbenchId, effects) {", '\n});\n');
const KEY_SRC = slice('  function cutKey(actorId, profileId, toProfile, parts) {', '\n  }\n');
// A master key cut again at a forge (#2254) is a third road, and asks too.
const MASTER_SRC = slice('  function cutMasterKey(actorId, profileId, toProfile, parts) {', '\n  }\n');
const FORGE_HERE_SRC = slice('  function forgeHere(parts, actorId) {', '\n  }\n');
const AT_FORGE_SRC = slice('  function atForge(actorId) {', '\n  }\n');
const TOUCHED_SRC = slice('  function touchedBench(actorId, baseDesc, refrId) {', '\n  }\n');
const BENCH_BY_BASE = table('BENCH_BY_BASE');
const STATIONS = table('STATIONS');
const WARMTH = table('WARMTH') || { items: {} };
const WEATHER = table('WEATHER') || { items: {} };
const WATERS = table('WATERS') || { items: {} };
const FORGE = (/^  var FORGE = '([^']+)';/m.exec(gm) || [])[1];
const MOLD_REACH = number('MOLD_REACH');
const DOOR_MEMORY_MS = number('DOOR_MEMORY_MS');
yes('the needs and injury blocks, the craft gate, the two roads and the forge pieces are in the gamemode',
    !!NEEDS_SRC && !!HURT_SRC && !!GATE_SRC && !!CRAFT_SRC && !!KEY_SRC &&
    !!FORGE_HERE_SRC && !!AT_FORGE_SRC && !!TOUCHED_SRC && !!BENCH_BY_BASE && !!STATIONS && !!FORGE &&
    MOLD_REACH > 0 && DOOR_MEMORY_MS > 0);
if (!NEEDS_SRC || !HURT_SRC || !GATE_SRC || !CRAFT_SRC || !KEY_SRC ||
    !FORGE_HERE_SRC || !AT_FORGE_SRC || !TOUCHED_SRC || !BENCH_BY_BASE || !STATIONS || !FORGE) { done(); }

function baseOf(keyword) {
  return Object.keys(BENCH_BY_BASE).filter(function (b) { return BENCH_BY_BASE[b] === keyword; })[0];
}
const FORGE_BASE = baseOf(FORGE);
const POT_BASE = baseOf('a5cb3:Skyrim.esm');
const KILN_BASE = STATIONS.charcoalKiln;
yes('the forge, the cooking pot and the kiln are benches the table knows, the kiln by the base the plugin places',
    !!FORGE_BASE && !!POT_BASE && !!KILN_BASE && !!BENCH_BY_BASE[KILN_BASE]);

const ME = 0xff000001;
const FORGE_REF = 0x000f0e;
const POT_REF = 0x000a01;
const KILN_REF = 0x000077;

/*
  The rig: the real needs and injury blocks over one store of properties and
  one clock, a forge, a cooking pot and a kiln in the world, and one person.
*/
function rig(opts) {
  const G = {};
  const props = {};
  const clock = { now: Date.UTC(2026, 9, 4, 20, 0, 0) };
  const bases = {};
  bases[FORGE_REF] = FORGE_BASE; bases[POT_REF] = POT_BASE; bases[KILN_REF] = KILN_BASE;
  const mp = {
    makeProperty: function () { },
    getDescFromId: function (id) { return 'ff' + id.toString(16) + ':Runtime'; },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return [ME]; }
      if (key === 'baseDesc') { return bases[id] || ''; }
      if (key === 'worldOrCellDesc') { return '3c:Skyrim.esm'; }
      if (key === 'profileId') { return 202; }
      if (key === 'isDead') { return false; }
      if (key === 'inventory') { return { entries: [] }; }
      if (key === 'equipment') { return { inv: { entries: [] } }; }
      if (key === 'pos') { return [0, 0, 0]; }
      return props[id] ? props[id][key] : undefined;
    },
    set: function (id, key, v) {
      if (!props[id]) { props[id] = {}; }
      props[id][key] = JSON.parse(JSON.stringify(v));
    },
    callPapyrusFunction: function () { }
  };
  const D = { now: function () { return clock.now; } };
  const common = ['globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
                  'guard', 'notify', 'say', 'Math', 'idOf'];
  const vals = [G, mp, D, { log: function () { } }, function () { return 0; }, function () { },
                function (n, f) { return f; }, function () { }, function () { }, Math,
                function () { return 0x10; }];
  new Function(common.concat(['WARMTH', 'WEATHER', 'WATERS']).join(','), NEEDS_SRC)
    .apply(null, vals.concat([WARMTH, WEATHER, WATERS]));
  new Function(common.concat(['BENCH_BY_BASE']).join(','), HURT_SRC)
    .apply(null, vals.concat([BENCH_BY_BASE]));
  const N = G.__thornswoodNeeds;
  const H = G.__thornswoodHurt;
  N.settle(ME);
  const n = N.fresh();
  n.rest = opts.rest === undefined ? 100 : opts.rest;
  n.at = clock.now;
  mp.set(ME, 'thornswoodNeeds', n);
  (opts.hurt || []).forEach(function (words) { H.staff(ME, words, 'staff'); });
  if (opts.minutes) { clock.now += opts.minutes * 60000; }
  const gate = new Function('globalThis', GATE_SRC + '\nreturn unfitToMake;')(G);
  return { G: G, mp: mp, clock: clock, N: N, H: H, gate: gate };
}

/* A bench's own menu: mp.onCraft as it stands, with stand-ins past the gate. */
function menu(r, bench, recipeId) {
  const said = [];
  const reached = [];
  const writes = [];
  const mp = {
    getDescFromId: function () { reached.push('desc'); return 'abc:Skyrim.esm'; },
    set: function (id, key) { writes.push(key); },
    get: function () { return null; }
  };
  const handler = new Function('globalThis', 'mp', 'guard', 'notify', 'say', 'log',
    'recipelessCraft', 'craftRow', 'craftAnswer', 'unfitToMake',
    'var onCraft;\n' + CRAFT_SRC.replace('mp.onCraft = guard(', 'onCraft = guard(') + '\nreturn onCraft;')(
    r.G, mp, function (n, f) { return f; },
    function (id, line) { said.push(line); }, function (id, line) { said.push(line); }, function () { },
    function () { reached.push('recipeless'); return undefined; },
    function () { reached.push('row'); return null; },
    function () { reached.push('answer'); return {}; }, r.gate);
  const out = handler(ME, 0x12, 1, recipeId === undefined ? 0x1234 : recipeId, bench, undefined);
  return { out: out, said: said, made: out !== false && reached.length > 0, took: writes.length };
}

/*
  A key at a forge: cutKey with the real forgeHere, atForge and touchedBench.
  parts is what the lock key sends; pressed is a forge press the server saw
  first, through touchedBench, the way mp.onActivate writes it.
*/
function key(r, parts, pressed) {
  const told = [];
  const took = [];
  const gave = [];
  const near = { far: 120 };
  const pieces = new Function('mp', 'BENCH_BY_BASE', 'FORGE', 'MOLD_REACH', 'DOOR_MEMORY_MS',
    'BENCH_PROPERTY', 'DOOR_PROPERTY', 'distanceTo', 'nameBenchStock',
    FORGE_HERE_SRC + AT_FORGE_SRC + TOUCHED_SRC + '\nreturn { forgeHere: forgeHere, touchedBench: touchedBench };')(
    r.mp, BENCH_BY_BASE, FORGE, MOLD_REACH, DOOR_MEMORY_MS, 'thornswoodBench', 'thornswoodDoor',
    // The bench's chests (#3159) are tests/test-3159-bench-stock.js's.
    function () { return near.far; }, function () { });
  if (pressed) { pieces.touchedBench(ME, pressed.base, pressed.ref); }
  const run = new Function('g', 'isSmith', 'forgeHere', 'moldInHand', 'heldBy', 'here', 'takeItem',
    'giveNamed', 'addItem', 'KEY_INGOT', 'KEY', 'keyLabel', 'nameOf', 'placeOf', 'plog', 'unfitToMake',
    'toolGate', 'wearTool',
    KEY_SRC + '\nreturn cutKey;')(
    r.G, function () { return true; }, pieces.forgeHere,
    function () { return 'home:Skyrim.esm'; }, function () { return []; }, function () { return ''; },
    function (id, item, n) { took.push(n); return true; },
    function () { gave.push(1); return true; }, function () { },
    'ingot', 'key', function () { return 'Key to Honeyside'; }, function () { return 'Honeyside'; },
    function () { return 'Honeyside'; },
    function () { }, r.gate,
    // The smith holds a hammer (#3162); tests/test-3162-bench-tools.js asks the refusal.
    function () { return null; }, function () { return null; });
  run(ME, 202, function (pid, m) { told.push(m); }, parts);
  return { said: told, made: gave.length > 0, took: took.length };
}

const ARM = /takes two hands, and your arm is broken/;
const HAND = /takes two hands, and you have one/;
const SICK = /too sick to work/;
const TIRED = /too tired to make anything/i;
const ROADS = {
  'a craft at the forge\'s own menu': function (r) { return menu(r, FORGE_REF); },
  'a key cut at a forge with the lock key': function (r) { return key(r, ['/key', FORGE_REF.toString(16)]); },
  'a key cut at the forge last pressed, with no id': function (r) {
    return key(r, ['/key'], { base: FORGE_BASE, ref: FORGE_REF });
  },
  'a craft at the kiln\'s own menu': function (r) { return menu(r, KILN_REF); }
};
function line(o) { return o.said.join(' | '); }

// ------------------------------------------------------- the gate itself --

{
  const r = rig({ hurt: [['break', 'arm']] });
  yes('G1 the gate refuses a broken arm at the forge and at the kiln, with the injury block\'s own line',
      ARM.test(r.gate(ME, FORGE_REF)) && /the forge/.test(r.gate(ME, FORGE_REF)) &&
      ARM.test(r.gate(ME, KILN_REF)) && /the kiln/.test(r.gate(ME, KILN_REF)));
  yes('G1 and not at the cooking pot, which takes one hand', r.gate(ME, POT_REF) === '');
  const both = rig({ hurt: [['break', 'arm']], rest: 3 });
  yes('G2 hurt and tired at once, the injury line is said, alone',
      ARM.test(both.gate(ME, FORGE_REF)) && !TIRED.test(both.gate(ME, FORGE_REF)));
  yes('G2 tired at a bench the arm does not refuse, the rest line', TIRED.test(both.gate(ME, POT_REF)));
  yes('G3 fit and rested, nothing is refused', rig({}).gate(ME, FORGE_REF) === '' && rig({}).gate(ME, KILN_REF) === '');
}

// ------------------------------------------------------ every road, both ways --

Object.keys(ROADS).forEach(function (name) {
  const road = ROADS[name];
  const arm = road(rig({ hurt: [['break', 'arm']] }));
  yes('R1 ' + name + ': a broken arm is refused with the injury line (' + line(arm) + ')',
      arm.said.length > 0 && arm.said.every(function (l) { return ARM.test(l); }));
  yes('R1 ' + name + ': and nothing is taken or made', arm.took === 0 && !arm.made);

  const hand = road(rig({ hurt: [['agreed', 'hand']] }));
  yes('R2 ' + name + ': a missing hand is refused', hand.said.length > 0 && hand.said.every(function (l) { return HAND.test(l); }) &&
      hand.took === 0 && !hand.made);

  const sick = road(rig({ hurt: [['fever']], minutes: 31 }));
  yes('R3 ' + name + ': a disease gone bad is refused, nothing taken', sick.said.length > 0 &&
      sick.said.every(function (l) { return SICK.test(l); }) && sick.took === 0 && !sick.made);

  const ill = road(rig({ hurt: [['fever']], minutes: 11 }));
  yes('R3 ' + name + ': the same disease only ill is not refused', ill.made && !ill.said.some(function (l) { return SICK.test(l); }));

  const leg = road(rig({ hurt: [['break', 'leg']] }));
  yes('R4 ' + name + ': a broken leg is not refused, the work is done', leg.made &&
      !leg.said.some(function (l) { return ARM.test(l) || HAND.test(l); }));

  const tired = road(rig({ rest: 5 }));
  yes('R5 ' + name + ': under 15 Rest is still refused by the rest gate, nothing taken',
      tired.said.length > 0 && tired.said.every(function (l) { return TIRED.test(l); }) && tired.took === 0 && !tired.made);

  const both = road(rig({ hurt: [['break', 'arm']], rest: 5 }));
  yes('R6 ' + name + ': hurt and tired, only the injury line', both.said.length > 0 &&
      both.said.every(function (l) { return ARM.test(l); }));

  const fit = road(rig({}));
  yes('R7 ' + name + ': fit and rested, the work is done', fit.made);
});

// ------------------------------------------- the key road's forge, measured --

{
  const sick = rig({ hurt: [['break', 'arm']] });
  const old = key(sick, ['/key'], null);
  sick.mp.set(ME, 'thornswoodBench', { bench: FORGE, at: sick.clock.now });
  const unknown = key(sick, ['/key'], null);
  yes('F1 with no forge pressed, or a forge written down before #1733 with no reference, ' +
      'the key is not cut and nothing is taken: the gate is never asked about a forge nobody can name',
      !old.made && old.took === 0 && /Stand at a forge/.test(line(old)) &&
      !unknown.made && unknown.took === 0 && /Stand at a forge/.test(line(unknown)));
  const pot = key(rig({}), ['/key', POT_REF.toString(16)]);
  yes('F2 an id that is not a forge is still refused as before', !pot.made && /Stand at a forge/.test(line(pot)));
}

// ------------------------------------------------------------ the wiring --

{
  const code = gm.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const gate = (function () {
    const a = code.indexOf('function unfitToMake(actorId, workbenchId) {');
    return a < 0 ? '' : code.slice(a, code.indexOf('\n}\n', a));
  })();
  const hurtAsks = code.match(/hurt\.craftRefusal\(/g) || [];
  const needsAsks = code.match(/needs\.craftRefusal\(/g) || [];
  yes('W1 the injury gate and the rest gate are each asked in one place in the whole gamemode, the craft gate',
      hurtAsks.length === 1 && needsAsks.length === 1 &&
      gate.indexOf('hurt.craftRefusal(actorId, workbenchId)') !== -1 && gate.indexOf('needs.craftRefusal(actorId)') !== -1);
  yes('W1 and the injury gate is asked first', gate.indexOf('hurt.craftRefusal(') < gate.indexOf('needs.craftRefusal('));
  const other = (code.match(/\bcraftRefusal\(/g) || []).length;
  yes('W2 no other code asks either block\'s craftRefusal by another name (only the two definitions and the gate)',
      other === 4);
  const calls = code.match(/\bunfitToMake\(actorId, [a-zA-Z]+\);/g) || [];
  yes('W3 the roads ask the gate: a bench\'s menu with its bench, the kiln\'s included, when the order is taken (#3161) and when it is made, a key with the forge, and a master key with the forge (#2254)',
      calls.length === 4 && !/function burnCharcoal\b/.test(code) &&
      /unfitToMake\(actorId, workbenchId\)/.test(CRAFT_SRC) &&
      !!WORK_SRC && /unfitToMake\(actorId, workbenchId\)/.test(WORK_SRC) &&
      /unfitToMake\(actorId, forge\)/.test(KEY_SRC) &&
      !!MASTER_SRC && /unfitToMake\(actorId, forge\)/.test(MASTER_SRC));
  yes('W4 each asks before anything is taken',
      CRAFT_SRC.indexOf('unfitToMake(') < CRAFT_SRC.indexOf('recipelessCraft(') &&
      KEY_SRC.indexOf('unfitToMake(') < KEY_SRC.indexOf('takeItem(') &&
      MASTER_SRC.indexOf('unfitToMake(') < MASTER_SRC.indexOf('takeItem('));
  yes('W5 the press writes down which forge, so a key cut with no id still names the bench',
      /prop\.touchedBench\(casterRefrId, baseDesc, refrId\)/.test(code));
  function body(start) {
    const a = code.indexOf(start);
    if (a < 0) { return ''; }
    return code.slice(a, code.indexOf('\n}\n', a));
  }
  const verbs = ['function mineSalt(', 'function chopWood(', 'function harvest('];
  yes('W6 mining, chopping and gathering do not ask it: the pages keep the class verbs going',
      verbs.every(function (v) { const b = body(v); return !!b && b.indexOf('unfitToMake') === -1; }));
}

done();
