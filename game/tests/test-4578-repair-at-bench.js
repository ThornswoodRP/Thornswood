// test-4578-repair-at-bench.js
//
// #4578. Decided 21 October: gear wears with use, and the right profession
// repairs it at its own bench (smiths at the forge, tailors at their bench),
// not just with the kit. Done when a piece can be mended only by its
// profession at that profession's bench, and anywhere else the repair says
// where to go. The kits, the 120% repair for the half that makes the kit,
// wear per hit and the dull clock stay as they are (test-1384-condition.js).
//
// Before this a repair was checked against holding the kit only: a cook in
// a field mended a sword. Here the durability block is cut out of the
// gamemode as it is, given the real recipe and bench tables, and driven two
// ways:
//
//   A  its factory, with a world this file controls: who is standing at
//      which bench, and who they are.
//   W  the whole block with a small engine (mp) under it, so the bench a
//      person stands at is found the way the server finds it: the
//      references around them (getNeighborsByPosition), the bench table
//      (BENCH_BY_BASE) and a reach.
//
// Read only. No game check is claimed: a person on Dev still has to mend at
// a forge and be refused away from it.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('../../tests/gamemode-tables.js');

const REPO_DIR = process.env.REPO_DIR || path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (detail !== undefined ? '  (' + detail + ')' : '')); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const start = gm.indexOf('// ==== thornswood durability ====');
const end = gm.indexOf('// ==== end thornswood durability ====');
yes('the durability block is in the gamemode', start >= 0 && end > start);
if (!(start >= 0 && end > start)) { done(); }
const block = gm.slice(start, end);

const RECIPES = T.table('RECIPES_BY_ID');
const ACCESS = T.table('BENCH_ACCESS');
const BY_BASE = T.table('BENCH_BY_BASE');

// ------------------------------------------------------- the real tables --

const FORGE = '88105:Skyrim.esm';
const LOOM = '6ce000:Update.esm';
const TANNING = '7866a:Skyrim.esm';
function madeAt(bench, owner, type, family) {
  const rows = (ACCESS[bench] && ACCESS[bench].rows) || [];
  for (let i = 0; i < rows.length; i++) {
    const r = RECIPES[rows[i]];
    if (r && r.owner === owner && r.type === type && r.out && (!family || r.family === family)) { return r; }
  }
  return null;
}
const SWORD_ROW = madeAt(FORGE, 'Smith', 'WEAP', 'Swords');
const ROBE_ROW = madeAt(LOOM, 'Tailor', 'ARMO');
yes('T1 the recipe table has a smith\'s weapon made at a forge, and a tailor\'s garment at a loom',
    !!SWORD_ROW && !!ROBE_ROW && ACCESS[FORGE].name === 'CraftingSmithingForge' && ACCESS[LOOM].name === 'MCE_CraftingLoom');
if (!SWORD_ROW || !ROBE_ROW) { done(); }

const KIT_ITEMS = { weapon: '154b0:Thornswood-Content.esp', armour: '154b1:Thornswood-Content.esp',
                    clothing: '154b2:Thornswood-Content.esp' };

// Ids for the descriptors this file uses.
const SWORD = 0x100001, ROBE = 0x100002, ODD = 0x100003, WEAPON_KIT = 0x5100001, SEWING_KIT = 0x5100003;
const DESC = {};
DESC[SWORD] = SWORD_ROW.out; DESC[ROBE] = ROBE_ROW.out; DESC[ODD] = 'abc:SomeoneElses.esp';
DESC[WEAPON_KIT] = KIT_ITEMS.weapon; DESC[SEWING_KIT] = KIT_ITEMS.clothing;
const ID = {};
Object.keys(DESC).forEach(function (k) { ID[DESC[k]] = Number(k); });

function le32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
const RECORDS = {};
RECORDS[SWORD] = { type: 'WEAP', fields: [] };
RECORDS[ODD] = { type: 'WEAP', fields: [] };
// A garment: the body slot, armour type 2 (clothing).
RECORDS[ROBE] = { type: 'ARMO', fields: [{ type: 'BOD2', data: le32(1 << 2).concat(le32(2)) }] };
RECORDS[WEAPON_KIT] = { type: 'MISC', fields: [] };
RECORDS[SEWING_KIT] = { type: 'MISC', fields: [] };

const SMITH = { prof: 'smith', half: 'edgewright', ranks: { edgewright: 'master' } };
const PLATE = { prof: 'smith', half: 'platewright', ranks: { platewright: 'novice' } };
const TAILOR = { prof: 'tailor', half: 'haberdasher', ranks: { haberdasher: 'novice' } };
const COOK = { prof: 'cook', half: 'hearthcook', ranks: { hearthcook: 'master' } };

const SWORD_NAME = SWORD_ROW.name, ROBE_NAME = ROBE_ROW.name;
const ME = 0xff000058;

// ------------------------------------------------- A. the factory, a world --

const fbox = { console: { log: function () {} } };
fbox.globalThis = fbox;
vm.runInNewContext(block, fbox);
const create = fbox.__thornswoodDurabilityCreate;
yes('A0 the block hands over its factory', typeof create === 'function');
if (typeof create !== 'function') { done(); }

function world() {
  const w = { packs: {}, states: {}, at: {}, writes: 0, shown: [] };
  w.api = create({
    kits: { weapon: Object.assign({}, fbox.__thornswoodDurabilityKits.weapon),
            armour: Object.assign({}, fbox.__thornswoodDurabilityKits.armour),
            clothing: Object.assign({}, fbox.__thornswoodDurabilityKits.clothing) },
    recipes: function () { return RECIPES; },
    benchAccess: function () { return ACCESS; },
    benchesHere: function (id) { return (w.at[id] || []).slice(); },
    descOf: function (id) { return DESC[id] || ''; },
    now: function () { return 1; }, random: function () { return 0.99; }, later: function () {},
    inventory: function (id) { return w.packs[id] ? w.packs[id].map(function (e) { return Object.assign({}, e); }) : null; },
    setInventory: function (id, entries) { w.writes++; w.packs[id] = entries.map(function (e) { return Object.assign({}, e); }); return true; },
    worn: function () { return []; },
    record: function () { return null; }, setRecord: function () { return true; },
    recordOf: function (id) { return RECORDS[id] || null; },
    nameOf: function (id) { return id === SWORD ? SWORD_NAME : id === ROBE ? ROBE_NAME : id === ODD ? 'Odd Blade' : ''; },
    idOf: function (desc) { return ID[desc] || 0; },
    stateOf: function (id) { return w.states[id] || null; },
    isPerson: function () { return true; }, isTool: function () { return false; },
    held: function () { return false; }, isContainer: function () { return false; },
    cellOf: function () { return ''; }, clockOf: function () { return null; }, setClock: function () {},
    show: function (id, v) { w.shown.push(JSON.parse(JSON.stringify(v))); },
    say: function () {}, log: function () {}
  });
  w.count = function (base, name) {
    return (w.packs[ME] || []).filter(function (e) { return e.baseId === base && (name === undefined || (e.name || '') === name); })
      .reduce(function (n, e) { return n + e.count; }, 0);
  };
  return w;
}
function pick(base, cond, name) { return { baseId: base, cond: cond, name: name }; }

{
  const w = world();
  w.packs[ME] = [{ baseId: SWORD, count: 1, name: SWORD_NAME + ' (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  w.states[ME] = SMITH;
  const r = w.api.repairWithKit(ME, pick(SWORD, 40, SWORD_NAME));
  yes('A1 a smith with a Weapon Kit and no bench near is refused, and nothing is used',
      !r.ok && w.writes === 0 && w.count(WEAPON_KIT) === 1, r.line);
  yes('A1 and the refusal says where to go: a forge',
      /mended at a forge/.test(r.line || '') && /Stand at one/.test(r.line || ''), r.line);
}
{
  const w = world();
  w.packs[ME] = [{ baseId: SWORD, count: 1, name: SWORD_NAME + ' (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  w.states[ME] = SMITH;
  w.at[ME] = [LOOM, TANNING];
  const r = w.api.repairWithKit(ME, pick(SWORD, 40, SWORD_NAME));
  yes('A2 a smith at a loom and a tanning rack is refused for a forge\'s piece, and nothing is used',
      !r.ok && w.writes === 0 && /mended at a forge/.test(r.line || ''), r.line);
}
{
  const w = world();
  w.packs[ME] = [{ baseId: SWORD, count: 1, name: SWORD_NAME + ' (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  w.states[ME] = COOK;
  w.at[ME] = [FORGE];
  const r = w.api.repairWithKit(ME, pick(SWORD, 40, SWORD_NAME));
  yes('A3 a cook holding a Weapon Kit at a forge is refused: it is a smith\'s work',
      !r.ok && w.writes === 0 && w.count(WEAPON_KIT) === 1 && /a smith's work/.test(r.line || ''), r.line);
  yes('A3 and says where a smith mends it', /at a forge/.test(r.line || ''), r.line);
}
{
  const w = world();
  w.packs[ME] = [{ baseId: SWORD, count: 1, name: SWORD_NAME + ' (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  w.states[ME] = TAILOR;
  w.at[ME] = [FORGE, LOOM];
  const r = w.api.repairWithKit(ME, pick(SWORD, 40, SWORD_NAME));
  yes('A4 a tailor at a forge (which opens for tailors) still cannot mend a smith\'s sword',
      !r.ok && w.writes === 0 && /a smith's work/.test(r.line || ''), r.line);
}
{
  const w = world();
  w.packs[ME] = [{ baseId: SWORD, count: 1, name: SWORD_NAME + ' (40%)' }, { baseId: WEAPON_KIT, count: 2 }];
  w.states[ME] = SMITH;
  w.at[ME] = [FORGE];
  const r = w.api.repairWithKit(ME, pick(SWORD, 40, SWORD_NAME));
  yes('A5 a smith at a forge mends it, and the 120% for an Edgewright at Master is unchanged',
      r.ok && r.to === 120 && w.count(SWORD, SWORD_NAME + ' (120%)') === 1 && w.count(WEAPON_KIT) === 1, r.line);
  const w2 = world();
  w2.packs[ME] = [{ baseId: SWORD, count: 1, name: SWORD_NAME + ' (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  w2.states[ME] = PLATE;
  w2.at[ME] = [FORGE];
  const r2 = w2.api.repairWithKit(ME, pick(SWORD, 40, SWORD_NAME));
  yes('A5 and the other half of the profession mends it to 100%, as before', r2.ok && r2.to === 100, r2.line);
}
{
  const w = world();
  w.packs[ME] = [{ baseId: ROBE, count: 1, name: ROBE_NAME + ' (30%)' }, { baseId: SEWING_KIT, count: 1 }];
  w.states[ME] = TAILOR;
  w.at[ME] = [FORGE];
  const r = w.api.repairWithKit(ME, pick(ROBE, 30, ROBE_NAME));
  yes('A6 a tailor at a forge cannot mend a garment made at a loom, and is told the loom',
      !r.ok && w.writes === 0 && /a loom/.test(r.line || ''), r.line);
  w.at[ME] = [LOOM];
  const r2 = w.api.repairWithKit(ME, pick(ROBE, 30, ROBE_NAME));
  yes('A6 at the loom it mends, with the Sewing Kit, to 120% for a Haberdasher',
      r2.ok && r2.to === 120 && w.count(SEWING_KIT) === 0, r2.line);
  const w2 = world();
  w2.packs[ME] = [{ baseId: ROBE, count: 1, name: ROBE_NAME + ' (30%)' }, { baseId: SEWING_KIT, count: 1 }];
  w2.states[ME] = SMITH;
  w2.at[ME] = [LOOM];
  const r3 = w2.api.repairWithKit(ME, pick(ROBE, 30, ROBE_NAME));
  yes('A6 a smith at a loom cannot mend it: a tailor\'s work', !r3.ok && /a tailor's work/.test(r3.line || ''), r3.line);
}
{
  const w = world();
  w.packs[ME] = [{ baseId: ODD, count: 1, name: 'Odd Blade (20%)' }, { baseId: WEAPON_KIT, count: 1 }];
  w.states[ME] = SMITH;
  const r = w.api.repairWithKit(ME, pick(ODD, 20, 'Odd Blade'));
  yes('A7 a weapon no recipe makes is mended where its kit is made, by its kit\'s trade: a smith at a forge',
      !r.ok && /mended at a forge/.test(r.line || ''), r.line);
  w.at[ME] = [FORGE];
  const r2 = w.api.repairWithKit(ME, pick(ODD, 20, 'Odd Blade'));
  yes('A7 and at a forge it mends', r2.ok, r2.line);
}
{
  const w = world();
  w.packs[ME] = [{ baseId: SWORD, count: 1, name: SWORD_NAME + ' (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  w.states[ME] = SMITH;
  w.api.panel(ME, []);
  const away = w.shown[0].rows[0];
  yes('A8 away from a forge the panel row has no button and says where to go',
      away && away.can === false && /mended at a forge/.test(away.where || ''), JSON.stringify(away));
  w.at[ME] = [FORGE];
  w.api.panel(ME, []);
  const here = w.shown[1].rows[0];
  yes('A8 at a forge the same row has its button and no where', here && here.can === true && !here.where, JSON.stringify(here));
}

// Every piece the recipe table makes that a kit mends has a bench a person
// can be told the name of.
{
  const missing = {};
  Object.keys(ACCESS).forEach(function (bench) {
    ((ACCESS[bench] && ACCESS[bench].rows) || []).forEach(function (id) {
      const r = RECIPES[id];
      if (!r || !r.owner || (r.type !== 'WEAP' && r.type !== 'ARMO')) { return; }
      missing[ACCESS[bench].name] = true;
    });
  });
  const named = fbox.__thornswoodDurabilityBenchWords || {};
  const without = Object.keys(missing).filter(function (n) { return !named[n]; });
  yes('A9 every bench a weapon or a garment is made at has words a person reads', !!fbox.__thornswoodDurabilityBenchWords && without.length === 0,
      without.join(', '));
}

// --------------------------------------------- W. the block on an engine --

const FORGE_REF = 0x2000a1, LOOM_REF = 0x2000a2, CHAIR = 0x2000a3;
const FORGE_BASE = Object.keys(BY_BASE).filter(function (b) { return BY_BASE[b] === FORGE; })[0];
yes('W0 the bench table names a forge\'s furniture', !!FORGE_BASE);
const CELL = 'WhiterunWarmaidens';
function engine(myPos) {
  const forms = {};
  forms[ME] = { worldOrCellDesc: CELL, pos: myPos, inventory: { entries: [] }, profileId: 7 };
  forms[FORGE_REF] = { worldOrCellDesc: CELL, pos: [0, 0, 0], baseDesc: FORGE_BASE };
  forms[CHAIR] = { worldOrCellDesc: CELL, pos: [50, 0, 0], baseDesc: 'chair:Skyrim.esm' };
  const e = {
    forms: forms, asked: 0, props: {},
    mp: {
      makeProperty: function () {},
      get: function (id, k) { return forms[id] ? forms[id][k] : undefined; },
      set: function (id, k, v) { if (!forms[id]) { forms[id] = {}; } forms[id][k] = JSON.parse(JSON.stringify(v)); },
      getNeighborsByPosition: function (cell, pos) {
        e.asked++;
        if (cell !== CELL || !Array.isArray(pos)) { throw new Error('getNeighborsByPosition takes a cell and a position'); }
        return [ME, FORGE_REF, CHAIR];
      },
      getDescFromId: function (id) { return DESC[id] || ''; },
      lookupEspmRecordById: function (id) { return RECORDS[id] ? { record: RECORDS[id] } : null; }
    }
  };
  return e;
}
function runBlock(e, state) {
  const box = {
    console: { log: function () {} },
    mp: e.mp,
    setTimeout: function () {},
    table: function (name) { return T.table(name); },
    BENCH_ACCESS: ACCESS, BENCH_BY_BASE: BY_BASE,
    idOf: function (desc) { return ID[desc] || 0; },
    log: function () {}, say: function () {},
    kindIsContainer: function () { return false; }
  };
  box.globalThis = box;
  box.__thornswoodCharacter = { stateOf: function () { return state; } };
  vm.runInNewContext(block, box);
  return box.__thornswoodDurability;
}
{
  const e = engine([120, 80, 0]);
  e.forms[ME].inventory.entries = [{ baseId: SWORD, count: 1, name: SWORD_NAME + ' (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  const D = runBlock(e, SMITH);
  const r = D && D.repairWithKit(ME, pick(SWORD, 40, SWORD_NAME));
  yes('W1 standing beside a forge, a smith mends through the block\'s own wiring',
      !!r && r.ok && e.asked > 0, r && r.line);
}
{
  const e = engine([3000, 0, 0]);
  e.forms[ME].inventory.entries = [{ baseId: SWORD, count: 1, name: SWORD_NAME + ' (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  const D = runBlock(e, SMITH);
  const r = D && D.repairWithKit(ME, pick(SWORD, 40, SWORD_NAME));
  yes('W2 across the room from the forge, out of reach, the same smith is refused and keeps the kit',
      !!r && !r.ok && /mended at a forge/.test(r.line || '') &&
      e.forms[ME].inventory.entries.some(function (x) { return x.baseId === WEAPON_KIT && x.count === 1; }), r && r.line);
}
{
  const e = engine([100, 0, 0]);
  e.forms[FORGE_REF].worldOrCellDesc = 'SomewhereElse';
  e.forms[ME].inventory.entries = [{ baseId: SWORD, count: 1, name: SWORD_NAME + ' (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  const D = runBlock(e, SMITH);
  const r = D && D.repairWithKit(ME, pick(SWORD, 40, SWORD_NAME));
  yes('W3 a forge in another cell is not the bench they stand at', !!r && !r.ok, r && r.line);
}

done();
