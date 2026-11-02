// test-3151-craft-quality.js
//
// #3151. Patrick, 22 October 2026, A: crafted things come in three tiers,
// crude, fine and masterwork, at minus or plus 10%, decided by skill and
// materials. A weapon that strikes and an armour piece with a rating are
// rolled at the bench by how many ranks the maker stands above the row's own
// rank; the tier is written on the piece's name through craftOutput, before
// the engine adds it; fine is the piece as its record has it. A garment, a
// staff, an instrument and a tool are not rolled.
//
// It cuts the quality pieces, wovenOutput and the durability block out of
// the gamemode as they are and drives them over a stand-in engine, and it
// reads the page. Prints PASS and FAIL lines; exit 1 when anything fails.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_DIR = process.env.REPO_DIR || path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const page = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'professions.md'), 'utf8').split(CR).join('');

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
function lineOf(re) { const m = re.exec(gm); return m ? m[0] : null; }

// ---------------------------------------------------------- 1. the pieces --
const pieces = [
  slice(gm, 'const CRAFT_QUALITY = {', '\n};'),
  lineOf(/^const QUALITY_WEAPON_FAMILIES = .*$/m),
  lineOf(/^const QUALITY_RANKS = .*$/m),
  cut('function qualityTier(margin, roll) {'),
  cut('function qualityRolled(row, baseId) {'),
  cut('function qualityMargin(actorId, row) {'),
  cut('function qualityOutput(actorId, row, margin) {'),
  cut('function holdsPerk(actorId, key) {'),
  cut('function wovenMark(actorId) {'),
  cut('function wovenOutput(actorId, row) {')
];
yes('1 the quality pieces are in the gamemode', pieces.every(Boolean));
yes('1 mp.onCraft reads the margin before the work is credited, and names the quality before the weaver\'s mark and a dish\'s days (#3163)',
  /\n  const margin = qualityMargin\(actorId, row\);\n  if \(answer\.credit\) \{/.test(gm) &&
  /\n  cookedOutput\(actorId, row\);\n  qualityOutput\(actorId, row, margin\);\n  wovenOutput\(actorId, row\);\n  spoilingOutput\(actorId\);\n  return;\n\}\);/.test(gm));
if (!pieces.every(Boolean)) {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// The progression rules, as the gamemode has them.
const progression = slice(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const pbox = { console: { log: function () {} } };
pbox.globalThis = pbox;
vm.runInNewContext(progression, pbox);
const P = pbox.__thornswoodProgression;
yes('1 the progression rules registered', !!P && typeof P.rankOf === 'function');
function person(prof, half, rank) {
  const r = P.pickProfession(P.fresh(), prof, half);
  if (r.ok && rank) { r.state.ranks[half] = rank; }
  return r.ok ? r.state : null;
}

// What the durability block would say a base is.
const IRON_SWORD = 0x12eb7, STAFF = 0x29b75, LUTE = 0x1d9b, AXE = 0x2f2f4, STEEL_ARMOR = 0x13952, ROBES = 0x10cee3, LEATHER = 0x3619e;
const KINDS = {};
KINDS[IRON_SWORD] = 'weapon'; KINDS[STAFF] = 'weapon'; KINDS[LUTE] = 'weapon'; KINDS[AXE] = '';
KINDS[STEEL_ARMOR] = 'armour'; KINDS[ROBES] = 'clothing'; KINDS[LEATHER] = 'armour';

function rig(state, opts) {
  opts = opts || {};
  let output = null;
  const said = [];
  const mp = {
    get: function (a, key) { return key === 'craftOutput' && output ? Object.assign({}, output) : undefined; },
    set: function (a, key, v) {
      if (key === 'craftOutput' && output) {
        output = Object.assign({}, output, v);
        if (output.name === null) { delete output.name; }
      }
    }
  };
  const g = {
    __thornswoodProgression: P,
    __thornswoodCharacter: { stateOf: function () { return state; }, weaveOf: function () { return opts.weave || ''; } },
    __thornswoodNeeds: { NEEDS: { wear: { woven: { degrees: 4, mark: 'Master-Woven ' } } } },
    __thornswoodManeuvers: { WOVEN: { mark: 'Master-Lined ', less: 0.1 } }
  };
  if (opts.durability !== false) {
    g.__thornswoodDurability = { pieceKind: function (id) { return Object.prototype.hasOwnProperty.call(KINDS, id) ? KINDS[id] : ''; } };
  }
  const fns = new Function('mp', 'globalThis', 'log', 'notify', 'say', 'Math',
    pieces.join('\n') + '\nreturn { tier: qualityTier, rolled: qualityRolled, margin: qualityMargin, output: qualityOutput, woven: wovenOutput };')(
    mp, g, function () { }, function () { }, function (a, t) { said.push(t); },
    { random: function () { return opts.roll === undefined ? 0.99 : opts.roll; }, max: Math.max, min: Math.min, floor: Math.floor });
  return {
    fns: fns,
    said: said,
    craft: function (row, baseId, count) {
      output = { baseId: baseId, count: count || 1 };
      const margin = fns.margin(0xff000001, row);
      fns.output(0xff000001, row, margin);
      fns.woven(0xff000001, row);
      const o = output;
      output = null;
      return o;
    },
    none: function (row) { output = null; fns.output(0xff000001, row, 3); return output; }
  };
}

// ----------------------------------------------------- 2. the tier, rolled --
attempt('2 the odds', function () {
  const f = rig(null).fns;
  yes('2 at the edge of your rank, a roll under 0.25 is crude', f.tier(0, 0.24) === 'crude');
  yes('2 then 0.05 of masterwork', f.tier(0, 0.25) === 'masterwork' && f.tier(0, 0.299) === 'masterwork');
  yes('2 and the rest fine', f.tier(0, 0.3) === 'fine' && f.tier(0, 0.99) === 'fine');
  yes('2 a master on novice stock never makes crude work', f.tier(3, 0) === 'masterwork' && f.tier(3, 0.349) === 'masterwork' && f.tier(3, 0.35) === 'fine');
  yes('2 more skill over the materials is less crude and more masterwork, rank by rank',
    [0, 1, 2, 3].every(function (m, i, a) {
      if (!i) { return true; }
      const lo = rig(null).fns;
      // crude share falls, masterwork share rises
      const crude = function (x) { let n = 0; for (let r = 0; r < 1; r += 0.001) { if (lo.tier(x, r) === 'crude') { n++; } } return n; };
      const best = function (x) { let n = 0; for (let r = 0; r < 1; r += 0.001) { if (lo.tier(x, r) === 'masterwork') { n++; } } return n; };
      return crude(m) <= crude(a[i - 1]) && best(m) > best(a[i - 1]);
    }));
  yes('2 a margin past the table is the top row, and a negative one the bottom', f.tier(7, 0.3) === 'masterwork' && f.tier(-2, 0.2) === 'crude');
});

// ------------------------------------------------------- 3. what is rolled --
attempt('3 what is rolled', function () {
  const f = rig(null).fns;
  yes('3 an iron sword is', f.rolled({ type: 'WEAP', family: 'Swords' }, IRON_SWORD));
  yes('3 a staff is not: it casts', !f.rolled({ type: 'WEAP', family: 'Staves' }, STAFF));
  yes('3 a lute is not: it plays', !f.rolled({ type: 'WEAP', family: 'Other weapons' }, LUTE));
  yes('3 a woodcutter\'s axe is not: it is a tool', !f.rolled({ type: 'WEAP', family: 'Other weapons' }, AXE));
  yes('3 steel armour is, and leather armour is', f.rolled({ type: 'ARMO', family: 'Body armour' }, STEEL_ARMOR) &&
    f.rolled({ type: 'ARMO', family: 'Body armour' }, LEATHER));
  yes('3 robes are not: clothing has no rating', !f.rolled({ type: 'ARMO', family: 'Robes and body wear' }, ROBES));
  yes('3 an arrow and a meal are not', !f.rolled({ type: 'AMMO', family: 'Arrows and bolts' }, 0x1397d) && !f.rolled({ type: 'ALCH' }, 0x65c97));
  const blind = rig(null, { durability: false }).fns;
  yes('3 with no durability block to say what a piece is, nothing is rolled', !blind.rolled({ type: 'WEAP', family: 'Swords' }, IRON_SWORD));
  // Every striking family the rule names is one the recipe table has.
  const fam = /^const QUALITY_WEAPON_FAMILIES = (\[.*\]);$/m.exec(gm);
  const names = fam ? JSON.parse(fam[1].replace(/'/g, '"')) : [];
  const recSrc = slice(gm, 'var RECIPES_BY_ID = {', ';\n');
  const RECIPES = new Function('return ' + recSrc.slice('var RECIPES_BY_ID = '.length).replace(/;$/, ''))();
  const have = {};
  Object.keys(RECIPES).forEach(function (k) { if (RECIPES[k].type === 'WEAP') { have[RECIPES[k].family] = true; } });
  yes('3 every family the rule rolls is a weapon family in the recipe table (' + names.join(', ') + ')',
    names.length === 8 && names.every(function (n) { return have[n]; }));
});

// ------------------------------------------------------ 4. skill over stock --
attempt('4 the margin', function () {
  const iron = { type: 'WEAP', family: 'Swords', half: 'Edgewright', rank: 'novice', name: 'Iron Sword' };
  const glass = { type: 'WEAP', family: 'Swords', half: 'Edgewright', rank: 'expert', name: 'Glass Sword' };
  yes('4 a master Edgewright on iron stands three ranks above it', rig(person('smith', 'edgewright', 'master')).fns.margin(1, iron) === 3);
  yes('4 and one above glass', rig(person('smith', 'edgewright', 'master')).fns.margin(1, glass) === 1);
  yes('4 a novice on iron stands at its edge', rig(person('smith', 'edgewright', 'novice')).fns.margin(1, iron) === 0);
  const plate = { type: 'ARMO', family: 'Body armour', half: 'Platewright', rank: 'novice', name: 'Iron Armor' };
  yes('4 a master Edgewright at the sister half\'s novice plate works it as the novice they are there',
    rig(person('smith', 'edgewright', 'master')).fns.margin(1, plate) === 0);
  yes('4 a character that cannot be read is a novice', rig(null).fns.margin(1, iron) === 0);
});

// --------------------------------------------------------- 5. the craft --
attempt('5 the craft', function () {
  const iron = { type: 'WEAP', family: 'Swords', owner: 'Smith', half: 'Edgewright', rank: 'novice', name: 'Iron Sword' };
  const novice = person('smith', 'edgewright', 'novice');
  const master = person('smith', 'edgewright', 'master');
  const r1 = rig(novice, { roll: 0.1 });
  const o1 = r1.craft(iron, IRON_SWORD);
  yes('5 a novice\'s crude iron sword is named so, through craftOutput', o1.name === 'Iron Sword (Crude)' && o1.baseId === IRON_SWORD && o1.count === 1);
  yes('5 and the smith is told', r1.said.length === 1 && /crude work/.test(r1.said[0]));
  const r2 = rig(master, { roll: 0.1 });
  const o2 = r2.craft(iron, IRON_SWORD);
  yes('5 the same roll for a master is masterwork', o2.name === 'Iron Sword (Masterwork)' && /masterwork/.test(r2.said[0]));
  const r3 = rig(master, { roll: 0.9 });
  const o3 = r3.craft(iron, IRON_SWORD);
  yes('5 fine is the piece as the record has it: no name, and nothing said', o3.name === undefined && r3.said.length === 0);
  const plate = { type: 'ARMO', family: 'Body armour', owner: 'Smith', half: 'Platewright', rank: 'advanced', name: 'Steel Armor' };
  const o4 = rig(person('smith', 'platewright', 'master'), { roll: 0.06 }).craft(plate, STEEL_ARMOR, 2);
  yes('5 a batch is one roll: both pieces carry the one name', o4.name === 'Steel Armor (Masterwork)' && o4.count === 2);
  const robes = { type: 'ARMO', family: 'Robes and body wear', owner: 'Tailor', half: 'Haberdasher', rank: 'novice', name: 'Adept Robes' };
  const r5 = rig(person('tailor', 'haberdasher', 'novice'), { roll: 0 });
  yes('5 robes are not rolled and nothing is said', r5.craft(robes, ROBES).name === undefined && r5.said.length === 0);
  yes('5 with no craftOutput from the engine nothing is named', rig(master, { roll: 0 }).none(iron) === null);
});

// ------------------------------------------- 6. the weaver's mark goes first --
attempt('6 the weaver', function () {
  // A master Liverywright's leather armour on the Armour pick: the quality is
  // on the name the mark goes in front of, where the maneuvers block reads it.
  const leather = { type: 'ARMO', family: 'Body armour', owner: 'Tailor', half: 'Liverywright', rank: 'novice', name: 'Leather Armor' };
  const s = person('tailor', 'liverywright', 'master');
  const master = Object.assign({}, s);
  const wasPerks = P.perks;
  P.perks = function () { return ['masterweaver']; };
  try {
    const o = rig(master, { roll: 0, weave: 'armour' }).craft(leather, LEATHER);
    yes('6 a woven masterwork piece reads Master-Lined Leather Armor (Masterwork)', o.name === 'Master-Lined Leather Armor (Masterwork)');
    const o2 = rig(master, { roll: 0.9, weave: 'armour' }).craft(leather, LEATHER);
    yes('6 and a woven fine one is the mark alone', o2.name === 'Master-Lined Leather Armor');
  } finally {
    P.perks = wasPerks;
  }
});

// ----------------------------------------- 7. durability keeps the quality --
const block = slice(gm, '// ==== thornswood durability ====', '// ==== end thornswood durability ====');
const dbox = { console: { log: function () {} } };
dbox.globalThis = dbox;
vm.runInNewContext(block, dbox);
const create = dbox.__thornswoodDurabilityCreate;
yes('7 the durability block hands over its factory', typeof create === 'function');
attempt('7 condition on a named piece', function () {
  function le32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
  const RECORDS = {};
  RECORDS[STEEL_ARMOR] = { type: 'ARMO', fields: [{ type: 'BOD2', data: le32(1 << 2).concat(le32(1)) }] };
  RECORDS[IRON_SWORD] = { type: 'WEAP', fields: [] };
  const NAMES = {};
  NAMES[STEEL_ARMOR] = 'Steel Armor'; NAMES[IRON_SWORD] = 'Iron Sword';
  const packs = {};
  const PERSON = 0xff000058, NPC = 0x1a2b3;
  const D = create({
    now: function () { return 1; }, random: function () { return 0.99; }, later: function () {},
    inventory: function (id) { return (packs[id] || []).map(function (e) { return Object.assign({}, e); }); },
    setInventory: function (id, e) { packs[id] = e.map(function (x) { return Object.assign({}, x); }); return true; },
    worn: function (id) { return (packs[id] || []).filter(function (e) { return e.worn; }); },
    record: function () { return null; }, setRecord: function () { return true; },
    recordOf: function (id) { return RECORDS[id] || null; }, nameOf: function (id) { return NAMES[id] || ''; },
    idOf: function () { return 0; }, stateOf: function () { return null; }, isPerson: function (id) { return id >= 0xff000000; },
    isTool: function () { return false; }, held: function () { return false; }, isContainer: function () { return false; },
    cellOf: function () { return ''; }, clockOf: function () { return null; }, setClock: function () {}, show: function () {},
    say: function () {}, log: function () {}
  });
  yes('7 a masterwork piece is 100% until something wears it', D.conditionOf({ baseId: STEEL_ARMOR, name: 'Steel Armor (Masterwork)' }) === 100);
  packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (Masterwork)', worn: true }];
  D.hit(PERSON, NPC, IRON_SWORD);
  yes('7 a hit writes the condition after the quality: Steel Armor (Masterwork) (99%)',
    packs[PERSON].length === 1 && packs[PERSON][0].name === 'Steel Armor (Masterwork) (99%)');
  const mended = D.withCondition(packs[PERSON][0], 100);
  yes('7 and a repair to 100% gives back the quality alone', mended.name === 'Steel Armor (Masterwork)');
  yes('7 a crude piece at 120% keeps both', D.withCondition({ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (Crude)' }, 120).name === 'Iron Sword (Crude) (120%)');
});

// -------------------------------------------------------------- 8. the page --
yes('8 the professions page says the three tiers, the 10% and what is rolled',
  /## Crude, fine and masterwork/.test(page) && /a tenth/.test(page) && /\(Masterwork\)/.test(page) && /\(Crude\)/.test(page));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
