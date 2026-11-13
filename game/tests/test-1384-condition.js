// test-1384-condition.js
//
// #1384. Condition runs from 0% to 120%. Three kits, and who makes them, are
// on docs/systems/durability.md: the half that makes the kit repairs to 120%
// and anybody else to 100%. At 0% a worn piece has a 10% chance to break on a
// hit, and a piece in a chest does not roll it. A piece in a shop chest or a
// house container loses 5% a real day; a pack does not, worn gear does not,
// and opening the chest does not reset the day. Tempering is not repair and
// is not counted as work (test-recipeless-craft.js drives the refusal; this
// checks it is wired). Glass, ebony and stalhrim take the same kits as iron.
//
// Patrick's answers of 4 October: a recipe for each kit, written on the page
// and carried by Thornswood-Content.esp; one kit per repair; 120% only for
// the half the person picked, never the sister half; worn gear loses 1% a
// hit; a weapon wears when it lands a hit or blocks one, not when its holder
// is hit. And no chat commands for what people do: the repair is a panel,
// opened by a key in the inventory, and /repair is only what the key and the
// panel send.
//
// The durability block is cut out of the gamemode as it is and run against a
// small world: packs, chests, records and a clock this file controls. The
// plugin is read as bytes, the client plugin and the panel as text.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_DIR = process.env.REPO_DIR || path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
const page = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'durability.md'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const block = slice(gm, '// ==== thornswood durability ====', '// ==== end thornswood durability ====');
yes('the durability block is in the gamemode', block !== null);
const box = { console: { log: function () {} } };
box.globalThis = box;
if (block) {
  // Without mp the block stops after handing over the factory, which is all
  // this needs.
  vm.runInNewContext(block, box);
}
const create = box.__thornswoodDurabilityCreate;
const KITS = box.__thornswoodDurabilityKits;
yes('the block hands over its factory and its kits', typeof create === 'function' && !!KITS);
if (typeof create !== 'function') {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// ------------------------------------------------------------------ records --

function le32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
function text(s) { return s.split('').map(function (c) { return c.charCodeAt(0); }).concat([0]); }
function weapon(edid) { return { type: 'WEAP', fields: [{ type: 'EDID', data: text(edid) }] }; }
const SHIELD_SLOT = 1 << 9;
function armo(edid, slots, armourType, keywords) {
  const f = [{ type: 'EDID', data: text(edid) }, { type: 'BOD2', data: le32(slots).concat(le32(armourType)) }];
  if (keywords) { f.push({ type: 'KWDA', data: [].concat.apply([], keywords.map(le32)) }); }
  return { type: 'ARMO', fields: f };
}
const BODY = 1 << 2, HANDS = 1 << 3, RING = 1 << 6, AMULET = 1 << 5, HEAD = 1;

const IRON_SWORD = 0x12eb7, GLASS_SWORD = 0x139a0, EBONY_ARMOR = 0x13961, STALHRIM = 0x2b6a6;
const STEEL_ARMOR = 0x13952, LEATHER = 0x3619e, ROBES = 0x10cee3, GLOVES = 0x261c1, SHIELD = 0x12eb6;
const GOLD_RING = 0x1cf2b, AMULET_OF = 0x9171b, PLAIN_RING = 0x5000001;
const PICKAXE = 0xe3c16, BREAD = 0x65c97, ARROW = 0x1397d;
const WEAPON_KIT = 0x5100001, ARMOR_KIT = 0x5100002, SEWING_KIT = 0x5100003;

const RECORDS = {};
RECORDS[IRON_SWORD] = weapon('IronSword');
RECORDS[GLASS_SWORD] = weapon('GlassSword');
RECORDS[EBONY_ARMOR] = armo('ArmorEbonyCuirass', BODY, 1);
RECORDS[STALHRIM] = armo('DLC2ArmorStalhrimHeavyCuirass', BODY, 1);
RECORDS[STEEL_ARMOR] = armo('ArmorSteelCuirassA', BODY, 1);
RECORDS[LEATHER] = armo('ArmorLeatherCuirass', BODY, 0);
RECORDS[ROBES] = armo('ClothesMGRobesAdept', BODY, 2);
RECORDS[GLOVES] = armo('ClothesFineGloves', HANDS, 2);
RECORDS[SHIELD] = armo('ArmorIronShield', SHIELD_SLOT, 1);
RECORDS[GOLD_RING] = armo('JewelryRingGold', RING, 2, [0x6bbe9, 0x10cd09]);
RECORDS[AMULET_OF] = armo('AmuletMara', AMULET, 2, [0x8f95a]);
RECORDS[PLAIN_RING] = armo('ModRing', RING, 2);
RECORDS[PICKAXE] = weapon('Pickaxe');
RECORDS[BREAD] = { type: 'ALCH', fields: [] };
RECORDS[ARROW] = { type: 'AMMO', fields: [] };
[WEAPON_KIT, ARMOR_KIT, SEWING_KIT].forEach(function (k) { RECORDS[k] = { type: 'MISC', fields: [] }; });

const NAMES = {};
NAMES[IRON_SWORD] = 'Iron Sword'; NAMES[GLASS_SWORD] = 'Glass Sword';
NAMES[EBONY_ARMOR] = 'Ebony Armor'; NAMES[STALHRIM] = 'Stalhrim Armor';
NAMES[STEEL_ARMOR] = 'Steel Armor'; NAMES[ROBES] = 'Adept Robes'; NAMES[GLOVES] = 'Fine Gloves';
NAMES[SHIELD] = 'Iron Shield';

const KIT_DESC = { 'weapon-kit:Test.esp': WEAPON_KIT, 'armor-kit:Test.esp': ARMOR_KIT, 'sewing-kit:Test.esp': SEWING_KIT,
                   'iron-sword': IRON_SWORD };
function testKits(withItems) {
  const out = {};
  Object.keys(KITS).forEach(function (k) {
    const row = Object.assign({}, KITS[k]);
    if (withItems) {
      row.item = { weapon: 'weapon-kit:Test.esp', armour: 'armor-kit:Test.esp', clothing: 'sewing-kit:Test.esp' }[k];
    }
    out[k] = row;
  });
  return out;
}

// -------------------------------------------------------------------- world --

const PERSON = 0xff000058, OTHER = 0xff000059, NPC = 0x1a2b3, CHEST = 0x10ab1, CAVE_CHEST = 0x20cd2;
const DAY = 24 * 60 * 60 * 1000;

function world(opts) {
  opts = opts || {};
  const w = {
    t: opts.t || 1000000,
    packs: {}, worn: {}, records: {}, recordWrites: 0, refuseRecord: false,
    held: {}, clocks: {}, states: {}, cells: {},
    rolls: (opts.rolls || []).slice(), said: [], logs: [], queue: [], writes: 0, refuseWrite: false,
    shown: []
  };
  w.api = create({
    kits: testKits(opts.kitsMade !== false),
    now: function () { return w.t; },
    random: function () { return w.rolls.length ? w.rolls.shift() : 0.99; },
    later: function (fn) { w.queue.push(fn); },
    inventory: function (id) {
      return w.packs[id] ? w.packs[id].map(function (e) { return Object.assign({}, e); }) : null;
    },
    setInventory: function (id, entries) {
      if (w.refuseWrite) { return false; }
      w.writes++;
      w.packs[id] = entries.map(function (e) { return Object.assign({}, e); });
      return true;
    },
    worn: function (id) {
      if (w.worn[id]) { return w.worn[id]; }
      if (w.records[id]) {
        return JSON.parse(JSON.stringify(w.records[id].inv.entries)).filter(function (e) { return e.worn || e.wornLeft; });
      }
      return (w.packs[id] || []).filter(function (e) { return e.worn || e.wornLeft; });
    },
    // The equipment record, and the engine's names-only write of it (#1651).
    record: function (id) { return w.records[id] ? JSON.parse(JSON.stringify(w.records[id])) : null; },
    setRecord: function (id, rec) {
      if (w.refuseRecord) { return false; }
      const was = w.records[id].inv.entries;
      const now = rec.inv.entries;
      // What EquipmentBinding::Set takes from an owned actor: nothing but names.
      const onlyNames = was.length === now.length && was.every(function (e, i) {
        const a = Object.assign({}, e), b = Object.assign({}, now[i]);
        delete a.name; delete b.name;
        return JSON.stringify(a) === JSON.stringify(b);
      });
      if (!onlyNames) { throw new Error('the record write changed more than names'); }
      w.recordWrites++;
      w.records[id] = JSON.parse(JSON.stringify(rec));
      return true;
    },
    recordOf: function (id) { return RECORDS[id] || null; },
    nameOf: function (id) { return NAMES[id] || ''; },
    idOf: function (desc) { return KIT_DESC[desc] || (/^ff/.test(desc) ? parseInt(desc, 16) : 0) || Number(desc) || 0; },
    stateOf: function (id) { return w.states[id] || null; },
    isPerson: function (id) { return id >= 0xff000000; },
    isTool: function (id) { return id === PICKAXE; },
    held: function (id) { return !!w.held[id]; },
    isContainer: function (desc) { return desc === 'chest'; },
    cellOf: function (id) { return w.cells[id] || 'WhiterunBreezehome'; },
    clockOf: function (id) { return w.clocks[id] || null; },
    setClock: function (id, c) { if (c) { w.clocks[id] = Object.assign({}, c); } else { delete w.clocks[id]; } },
    show: function (id, v) { w.shown.push({ id: id, view: JSON.parse(JSON.stringify(v)) }); },
    say: function (id, m) { w.said.push(m); },
    log: function () { w.logs.push(Array.prototype.join.call(arguments, ' ')); }
  });
  w.flush = function () { const q = w.queue.splice(0); q.forEach(function (fn) { fn(); }); };
  w.count = function (id, baseId, name) {
    return (w.packs[id] || []).filter(function (e) {
      return e.baseId === baseId && (name === undefined || (e.name || '') === name);
    }).reduce(function (n, e) { return n + e.count; }, 0);
  };
  return w;
}
const D = world().api;

// ---------------------------------------------------------- the condition --

yes('a plain piece is at 100%', D.conditionOf({ baseId: IRON_SWORD, count: 1 }) === 100);
yes('the condition is the number on the end of the name',
    D.conditionOf({ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (85%)' }) === 85);
yes('it never reads past 120% or under 0%',
    D.conditionOf({ name: 'Iron Sword (180%)' }) === 120 && D.conditionOf({ name: 'Iron Sword (0%)' }) === 0);
yes('a name with a number in it that is not on the end is not a condition',
    D.conditionOf({ name: 'Sword (50%) of Fire' }) === 100);
yes('the page and the block agree on the ends: 0, 100 and 120',
    D.CONDITION.lowest === 0 && D.CONDITION.sound === 100 && D.CONDITION.highest === 120 &&
    /from 0% to 120%/.test(page));
{
  const at85 = D.withCondition({ baseId: IRON_SWORD, count: 2 }, 85);
  const back = D.withCondition(at85, 100);
  const named = D.withCondition({ baseId: GLASS_SWORD, count: 1, name: 'Shard of Morning' }, 40);
  yes('a piece below 100% says so in its name', at85.name === 'Iron Sword (85%)' && at85.count === 2);
  yes('back at 100% it is plain again, and stacks with plain ones', back.name === undefined);
  yes('a name somebody gave a piece is kept, with the condition after it',
      named.name === 'Shard of Morning (40%)' &&
      D.withCondition(named, 100).name === 'Shard of Morning');
}

// ---------------------------------------------------------- what has one --

yes('a weapon has a condition', D.pieceKind(IRON_SWORD) === 'weapon');
yes('heavy and light armour are armour',
    D.pieceKind(STEEL_ARMOR) === 'armour' && D.pieceKind(LEATHER) === 'armour');
yes('robes and gloves are clothing', D.pieceKind(ROBES) === 'clothing' && D.pieceKind(GLOVES) === 'clothing');
yes('a ring and an amulet are jewellery and have none, by keyword',
    D.pieceKind(GOLD_RING) === '' && D.pieceKind(AMULET_OF) === '');
yes('a ring a mod forgot to mark has none either, by its slot', D.pieceKind(PLAIN_RING) === '');
yes('the pickaxe wears by use and has no condition here', D.pieceKind(PICKAXE) === '');
yes('food, arrows and a kit have none',
    D.pieceKind(BREAD) === '' && D.pieceKind(ARROW) === '' && D.pieceKind(WEAPON_KIT) === '');
yes('a record that cannot be read has none', D.pieceKind(0x7777777) === '');
yes('glass, ebony and stalhrim are the same kinds as iron, so they take the same kits',
    D.pieceKind(GLASS_SWORD) === D.pieceKind(IRON_SWORD) &&
    D.pieceKind(EBONY_ARMOR) === 'armour' && D.pieceKind(STALHRIM) === 'armour');

// ---------------------------------------------------------- the kits -------

function pageKits() {
  const rows = {};
  page.split('\n').forEach(function (line) {
    const m = /^\| (Weapon Kit|Armor Kit|Sewing Kit) \| (\w+) \| (.+) \|$/.exec(line);
    if (m) { rows[m[1]] = m[2]; }
  });
  return rows;
}
{
  const rows = pageKits();
  yes('the three kits on the page are the three in the block, with the same makers',
      Object.keys(rows).length === 3 &&
      rows['Weapon Kit'] === KITS.weapon.maker && rows['Armor Kit'] === KITS.armour.maker &&
      rows['Sewing Kit'] === KITS.clothing.maker &&
      KITS.weapon.half === 'edgewright' && KITS.armour.half === 'platewright' &&
      KITS.clothing.half === 'haberdasher');
  yes('each kit names its record in Thornswood-Content.esp',
      KITS.weapon.item === '154b0:Thornswood-Content.esp' &&
      KITS.armour.item === '154b1:Thornswood-Content.esp' &&
      KITS.clothing.item === '154b2:Thornswood-Content.esp');
}

// ---------------------------------------------------------- the plugin -----
//
// Read as bytes: every record in Thornswood-Content.esp is uncompressed, and
// the three kits and their three recipes have to be there, with the inputs,
// the bench and the output the page names.

function readPlugin(buf) {
  const recs = {};
  function walk(at, end) {
    while (at + 24 <= end) {
      const tag = buf.toString('latin1', at, at + 4);
      const size = buf.readUInt32LE(at + 4);
      if (tag === 'GRUP') { walk(at + 24, at + size); at += size; continue; }
      const flags = buf.readUInt32LE(at + 8), fid = buf.readUInt32LE(at + 12);
      const subs = [];
      let p = at + 24;
      const stop = at + 24 + size;
      while (!(flags & 0x40000) && p + 6 <= stop) {
        const st = buf.toString('latin1', p, p + 4), ss = buf.readUInt16LE(p + 4);
        subs.push({ tag: st, data: buf.slice(p + 6, p + 6 + ss) });
        p += 6 + ss;
      }
      recs[fid] = { tag: tag, subs: subs };
      at = stop;
    }
  }
  const headSize = buf.readUInt32LE(4);
  walk(24 + headSize, buf.length);
  return recs;
}
function sub(rec, tag) { const s = rec.subs.filter(function (x) { return x.tag === tag; }); return s; }
function zs(b) { return b.toString('latin1').replace(/\0+$/, ''); }
const plugin = readPlugin(fs.readFileSync(path.join(REPO_DIR, 'game', 'content', 'Thornswood-Content.esp')));
// The plugin's own records are 0x05 in front of the local id: five masters.
function own05(desc) { return (0x05000000 | parseInt(desc.split(':')[0], 16)) >>> 0; }
const IRON_INGOT_ID = 0x5ace4, LEATHER_STRIPS_ID = 0x800e4, LEATHER_ID = 0xdb5d2, TUNDRA_COTTON_ID = 0x3f7f8;
const FORGE = 0x88105, TANNING_RACK = 0x7866a;
const KIT_RECIPES = [
  { kit: 'weapon', name: 'Weapon Kit', recipe: 0x50154b3, edid: 'ThornswoodRecipeWeaponKit', bench: FORGE,
    inputs: [[IRON_INGOT_ID, 1], [LEATHER_STRIPS_ID, 1]], words: '| Weapon Kit | 1 Iron Ingot, 1 Leather Strips | Forge | Smith, Edgewright |' },
  { kit: 'armour', name: 'Armor Kit', recipe: 0x50154b4, edid: 'ThornswoodRecipeArmorKit', bench: FORGE,
    inputs: [[IRON_INGOT_ID, 1], [LEATHER_ID, 1]], words: '| Armor Kit | 1 Iron Ingot, 1 Leather | Forge | Smith, Platewright |' },
  { kit: 'clothing', name: 'Sewing Kit', recipe: 0x50154b5, edid: 'ThornswoodRecipeSewingKit', bench: TANNING_RACK,
    inputs: [[TUNDRA_COTTON_ID, 1], [LEATHER_STRIPS_ID, 1]], words: '| Sewing Kit | 1 Tundra Cotton, 1 Leather Strips | Tanning rack | Tailor, Haberdasher |' }
];
KIT_RECIPES.forEach(function (k) {
  const fid = own05(KITS[k.kit].item);
  const misc = plugin[fid];
  yes('the plugin carries the ' + k.name + ' as a MISC under that name',
      !!misc && misc.tag === 'MISC' && sub(misc, 'FULL').length === 1 && zs(sub(misc, 'FULL')[0].data) === k.name);
  const cobj = plugin[k.recipe];
  const ins = cobj ? sub(cobj, 'CNTO').map(function (c) { return [c.data.readUInt32LE(0), c.data.readUInt32LE(4)]; }) : [];
  yes('and ' + k.edid + ' makes one out of exactly what the page says, at that bench',
      !!cobj && cobj.tag === 'COBJ' && zs(sub(cobj, 'EDID')[0].data) === k.edid &&
      sub(cobj, 'CNAM')[0].data.readUInt32LE(0) === fid &&
      sub(cobj, 'BNAM')[0].data.readUInt32LE(0) === k.bench &&
      sub(cobj, 'COCT')[0].data.readUInt32LE(0) === k.inputs.length &&
      JSON.stringify(ins) === JSON.stringify(k.inputs) && page.indexOf(k.words) !== -1);
});
{
  // RECIPE_OWNER's entries, which Build-RecipeTable.ps1 reads from records/recipe-owners.json.
  const named = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'records', 'recipe-owners.json'), 'utf8')).owner;
  const is = (edid, owner, half) => !!named[edid] && named[edid].Owner === owner && named[edid].Half === half;
  yes('the three recipes are named to their halves in records/recipe-owners.json, so the rebuilt table gates them',
      is('ThornswoodRecipeWeaponKit', 'Smith', 'Edgewright') &&
      is('ThornswoodRecipeArmorKit', 'Smith', 'Platewright') &&
      is('ThornswoodRecipeSewingKit', 'Tailor', 'Haberdasher'));
  const add = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'mods', 'Add-ContentRecords.py'), 'utf8');
  yes('and Add-ContentRecords.py is what adds the six records',
      ['ThornswoodMiscWeaponKit', 'ThornswoodMiscArmorKit', 'ThornswoodMiscSewingKit',
       'ThornswoodRecipeWeaponKit', 'ThornswoodRecipeArmorKit', 'ThornswoodRecipeSewingKit'].every(function (e) {
        // Written by the tool from its own numbers (#2553).
        return new RegExp("\\(\\s*[A-Z_]+,\\s*'" + e + "',").test(add);
      }));
}

// A Master Edgewright: the smiths' 120% waits for Master (Patrick, 26 Oct, #3442).
const EDGE = { prof: 'smith', half: 'edgewright', ranks: { edgewright: 'master', platewright: 'novice' } };
const EDGE_NOVICE = { prof: 'smith', half: 'edgewright', ranks: { edgewright: 'novice', platewright: 'novice' } };
const PLATE_EXPERT = { prof: 'smith', half: 'platewright', ranks: { platewright: 'expert', edgewright: 'novice' } };
const PLATE = { prof: 'smith', half: 'platewright', ranks: { platewright: 'master', edgewright: 'novice' } };
const HABER = { prof: 'tailor', half: 'haberdasher', ranks: { haberdasher: 'novice' } };
const LIVERY = { prof: 'tailor', half: 'liverywright', ranks: { liverywright: 'master', haberdasher: 'novice' } };
const COOK = { prof: 'cook', half: 'hearthcook', ranks: { hearthcook: 'expert' } };

yes('the Edgewright mends with a Weapon Kit to 120% at Master', D.repairTo(EDGE, 'weapon') === 120);
yes('below Master, the Edgewright mends with it to 100%, like anybody else (#3442)',
    D.repairTo(EDGE_NOVICE, 'weapon') === 100);
yes('an expert Platewright mends with an Armor Kit to 100%, not 120%',
    D.repairTo(PLATE_EXPERT, 'armour') === 100);
yes('a smith with no ranks written down mends to 100%',
    D.repairTo({ prof: 'smith', half: 'edgewright' }, 'weapon') === 100);
yes('the two smith kits are the ones that wait for Master, and the Sewing Kit is not',
    KITS.weapon.atMaster === true && KITS.armour.atMaster === true && !KITS.clothing.atMaster);
yes('the Platewright, the other half of the same profession, to 100%, even at master',
    D.repairTo(PLATE, 'weapon') === 100);
yes('the Platewright mends with an Armor Kit to 120%', D.repairTo(PLATE, 'armour') === 120);
yes('a novice Haberdasher mends with a Sewing Kit to 120%, the Liverywright to 100%',
    D.repairTo(HABER, 'clothing') === 120 && D.repairTo(LIVERY, 'clothing') === 100);
yes('a Liverywright with the sister half at master under a master still mends to 100% (Patrick, 4 October)',
    D.repairTo({ prof: 'tailor', half: 'liverywright', ranks: { liverywright: 'novice', haberdasher: 'master' },
                 masters: { haberdasher: 0xff000077 } }, 'clothing') === 100);
yes('anybody else, and somebody with no profession, to 100%',
    D.repairTo(COOK, 'weapon') === 100 && D.repairTo(null, 'armour') === 100 && D.repairTo({}, 'clothing') === 100);

// A repair, end to end. The panel's button names the row: base, condition, name.
function row(baseId, cond, name) { return { baseId: baseId, cond: cond, name: name }; }
{
  const w = world({ kitsMade: false });
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (40%)' }];
  w.states[PERSON] = EDGE;
  const r = w.api.repairWithKit(PERSON, row(IRON_SWORD, 40, 'Iron Sword'));
  yes('with no kit record in the plugin, a repair is refused and says no kit has been made',
      !r.ok && /no Weapon Kit has been made/.test(r.line) && w.writes === 0);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (40%)' }];
  w.states[PERSON] = EDGE;
  const r = w.api.repairWithKit(PERSON, row(IRON_SWORD, 40, 'Iron Sword'));
  yes('without the kit in the pack it is refused, and says who makes them',
      !r.ok && /Weapon Kit, and you have none\. An Edgewright makes them\./.test(r.line) && w.writes === 0);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (40%)' },
                     { baseId: WEAPON_KIT, count: 2 }];
  w.states[PERSON] = EDGE;
  const r = w.api.repairWithKit(PERSON, row(IRON_SWORD, 40, 'Iron Sword'));
  yes('an Edgewright\'s Weapon Kit puts an iron sword at 120%',
      r.ok && r.to === 120 && r.from === 40 && w.count(PERSON, IRON_SWORD, 'Iron Sword (120%)') === 1 &&
      w.count(PERSON, IRON_SWORD, 'Iron Sword (40%)') === 0);
  yes('and uses up one kit', w.count(PERSON, WEAPON_KIT) === 1 && /Weapon Kit is used up/.test(r.line));
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (40%)' },
                     { baseId: IRON_SWORD, count: 2 },
                     { baseId: WEAPON_KIT, count: 1 }];
  w.states[PERSON] = PLATE;
  const r = w.api.repairWithKit(PERSON, row(IRON_SWORD, 40, 'Iron Sword'));
  yes('a Platewright\'s repair with the same kit is 100%, and the sword stacks with the plain ones',
      r.ok && r.to === 100 && w.count(PERSON, IRON_SWORD, '') === 3 && w.packs[PERSON].length === 1);
  yes('and the last kit is gone from the pack', w.count(PERSON, WEAPON_KIT) === 0);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (120%)' },
                     { baseId: WEAPON_KIT, count: 1 }];
  w.states[PERSON] = COOK;
  const r = w.api.repairWithKit(PERSON, row(IRON_SWORD, 120, 'Iron Sword'));
  yes('a piece at 120% is not pulled down to 100% by somebody else\'s repair, and no kit is used',
      !r.ok && /at 120%/.test(r.line) && w.writes === 0);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: GLASS_SWORD, count: 1, name: 'Glass Sword (75%)' },
                     { baseId: GLASS_SWORD, count: 2, name: 'Glass Sword (10%)' },
                     { baseId: WEAPON_KIT, count: 1 }];
  w.states[PERSON] = EDGE;
  const r = w.api.repairWithKit(PERSON, row(GLASS_SWORD, 10, 'Glass Sword'));
  yes('the row the button names is the one mended, one unit of its stack',
      r.ok && r.from === 10 && w.count(PERSON, GLASS_SWORD, 'Glass Sword (10%)') === 1 &&
      w.count(PERSON, GLASS_SWORD, 'Glass Sword (120%)') === 1 &&
      w.count(PERSON, GLASS_SWORD, 'Glass Sword (75%)') === 1);
  yes('a glass sword takes the Weapon Kit, the same as iron', r.kit === 'weapon');
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: EBONY_ARMOR, count: 1, name: 'Ebony Armor (30%)', worn: true },
                     { baseId: WEAPON_KIT, count: 3 }];
  w.states[PERSON] = PLATE;
  const r = w.api.repairWithKit(PERSON, row(EBONY_ARMOR, 30, 'Ebony Armor'));
  yes('armour is not mended with a Weapon Kit', !r.ok && /Armor Kit, and you have none/.test(r.line) &&
      w.count(PERSON, WEAPON_KIT) === 3);
  w.packs[PERSON].push({ baseId: ARMOR_KIT, count: 1 });
  const r2 = w.api.repairWithKit(PERSON, row(EBONY_ARMOR, 30, 'Ebony Armor'));
  const piece = w.packs[PERSON].filter(function (e) { return e.baseId === EBONY_ARMOR; })[0];
  yes('ebony takes the Armor Kit like iron, and the Platewright puts it at 120%',
      r2.ok && r2.to === 120 && piece && piece.name === 'Ebony Armor (120%)');
  yes('a worn piece mended stays worn', piece && piece.worn === true);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: ROBES, count: 1, name: 'Adept Robes (55%)' },
                     { baseId: SEWING_KIT, count: 1 }];
  w.states[PERSON] = LIVERY;
  const r = w.api.repairWithKit(PERSON, row(ROBES, 55, 'Adept Robes'));
  yes('robes take the Sewing Kit; the Liverywright mends them to 100%',
      r.ok && r.kit === 'clothing' && r.to === 100 && w.count(PERSON, ROBES, '') === 1);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (40%)' },
                     { baseId: WEAPON_KIT, count: 1 }];
  w.states[PERSON] = EDGE;
  w.refuseWrite = true;
  const r = w.api.repairWithKit(PERSON, row(IRON_SWORD, 40, 'Iron Sword'));
  yes('a repair that cannot be written takes nothing and says so',
      !r.ok && /Nothing was used/.test(r.line) && w.count(PERSON, WEAPON_KIT) === 1);
  w.refuseWrite = false;
  const r2 = w.api.repairWithKit(PERSON, row(GOLD_RING, 100, 'Gold Ring'));
  yes('a ring is not something a kit mends', !r2.ok && /not in your pack any more/.test(r2.line) && w.writes === 0);
  const r3 = w.api.repairWithKit(PERSON, row(IRON_SWORD, 55, 'Iron Sword'));
  yes('a row whose piece has changed since the panel was drawn mends nothing',
      !r3.ok && /not in your pack any more/.test(r3.line) && w.count(PERSON, WEAPON_KIT) === 1);
}
// ---------------------------------------------------------- the panel -----

{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 2, name: 'Iron Sword (40%)' },
                     { baseId: STEEL_ARMOR, count: 1 },
                     { baseId: ROBES, count: 1, name: 'Adept Robes (120%)' },
                     { baseId: GLOVES, count: 1, name: 'Fine Gloves (70%)', worn: true },
                     { baseId: GOLD_RING, count: 1 },
                     { baseId: WEAPON_KIT, count: 2 }];
  w.states[PERSON] = COOK;
  const said = w.api.panel(PERSON, []);
  const v = w.shown.length === 1 && w.shown[0].id === PERSON ? w.shown[0].view : null;
  yes('the inventory key draws the panel on the owner\'s own view, and says nothing in the chat',
      !!v && v.open === true && said === '' && w.said.length === 0);
  const names = v ? v.rows.map(function (r) { return r.name + ' ' + r.cond; }) : [];
  yes('the panel lists what is not at 100%, worst first, and no ring and no sound piece',
      JSON.stringify(names) === JSON.stringify(['Iron Sword 40', 'Fine Gloves 70', 'Adept Robes 120']));
  const sword = v && v.rows[0];
  yes('a row says its count, its kit, what a repair by this person comes out at, and the base to send back',
      sword.count === 2 && sword.kit === 'Weapon Kit' && sword.to === 100 && sword.can === true &&
      sword.base === IRON_SWORD.toString(16));
  yes('a row whose kit is not carried has no button, and one already past the number has none either',
      v.rows[1].can === false && v.rows[1].worn === true && v.rows[2].can === false && v.rows[2].to === 100);
  const kits = v ? v.kits : [];
  yes('the kits are listed, with how many are carried and that the world has them',
      kits.length === 3 && kits[0].name === 'Weapon Kit' && kits[0].count === 2 && kits[0].made &&
      kits[1].count === 0 && kits[2].maker === 'Haberdasher');
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1 }, { baseId: STEEL_ARMOR, count: 1 },
                     { baseId: WEAPON_KIT, count: 1 }];
  w.states[PERSON] = EDGE;
  w.api.panel(PERSON, []);
  const rows = w.shown[0].view.rows;
  yes('for the half that makes a kit, a sound piece that kit would raise to 120% is a row too',
      rows.length === 1 && rows[0].name === 'Iron Sword' && rows[0].cond === 100 && rows[0].to === 120 && rows[0].can);
  const said = w.api.panel(PERSON, ['mend', IRON_SWORD.toString(16), '100', 'Iron', 'Sword']);
  yes('the button mends that row, says so in the chat, and draws the panel again',
      /Iron Sword is at 120% now/.test(said) && w.count(PERSON, IRON_SWORD, 'Iron Sword (120%)') === 1 &&
      w.count(PERSON, WEAPON_KIT) === 0 && w.shown.length === 2 && w.shown[1].view.rows.length === 1 &&
      w.shown[1].view.rows[0].cond === 120 && w.shown[1].view.rows[0].can === false);
}
{
  const w = world({ kitsMade: false });
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (40%)' }];
  w.api.panel(PERSON, []);
  const v = w.shown[0].view;
  yes('on a server whose plugin has no kits, the panel knows none has been made',
      v.kits.every(function (k) { return !k.made && k.count === 0; }) && v.rows[0].can === false);
}

// ---------------------------------------------------------- the dull clock --

function stocked(w) {
  w.held[CHEST] = true;
  w.packs[CHEST] = [{ baseId: IRON_SWORD, count: 3 },
                    { baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (120%)' },
                    { baseId: ROBES, count: 1, name: 'Adept Robes (3%)' },
                    { baseId: GLOVES, count: 1, name: 'Fine Gloves (0%)' },
                    { baseId: BREAD, count: 4 },
                    { baseId: GOLD_RING, count: 1 }];
}
{
  const w = world();
  stocked(w);
  w.api.pressed(PERSON, CHEST, 'chest');
  yes('the first opening of a stocked chest in a held building starts its clock and takes nothing',
      !!w.clocks[CHEST] && w.clocks[CHEST].at === w.t && w.writes === 0);
  const started = w.clocks[CHEST].at;
  w.t += DAY - 1000;
  w.api.pressed(PERSON, CHEST, 'chest');
  yes('before a whole day has turned, nothing is lost', w.writes === 0);
  w.t += 2000;
  w.api.pressed(PERSON, CHEST, 'chest');
  yes('a day on, every piece in it loses 5%',
      w.count(CHEST, IRON_SWORD, 'Iron Sword (95%)') === 3 &&
      w.count(CHEST, STEEL_ARMOR, 'Steel Armor (115%)') === 1);
  yes('a piece never goes under 0%', w.count(CHEST, ROBES, 'Adept Robes (0%)') === 1 &&
      w.count(CHEST, GLOVES, 'Fine Gloves (0%)') === 1);
  yes('food and a ring in the chest are not touched',
      w.count(CHEST, BREAD, '') === 4 && w.count(CHEST, GOLD_RING, '') === 1);
  const writes = w.writes;
  w.api.pressed(PERSON, CHEST, 'chest');
  w.api.pressed(OTHER, CHEST, 'chest');
  yes('opening it again the same day takes nothing more', w.writes === writes &&
      w.count(CHEST, IRON_SWORD, 'Iron Sword (95%)') === 3);
  yes('and opening it never moves the clock, so the day is not reset', w.clocks[CHEST].at === started);
  // Taken out and put back inside the day: the chest's day still turns on it.
  w.packs[CHEST] = w.packs[CHEST].filter(function (e) { return e.baseId !== IRON_SWORD; });
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 3, name: 'Iron Sword (95%)' }];
  w.t += DAY / 2;
  w.api.pressed(PERSON, CHEST, 'chest');
  w.packs[CHEST].push(w.packs[PERSON].pop());
  w.t += DAY / 2 + 1000;
  w.api.pressed(PERSON, CHEST, 'chest');
  yes('taking a piece out and putting it back does not reset its day either',
      w.count(CHEST, IRON_SWORD, 'Iron Sword (90%)') === 3);
  w.t += 3 * DAY;
  w.api.pressed(PERSON, CHEST, 'chest');
  yes('three days left alone are three times 5%, applied at the next opening',
      w.count(CHEST, IRON_SWORD, 'Iron Sword (75%)') === 3 && w.count(CHEST, STEEL_ARMOR, 'Steel Armor (95%)') === 1);
  w.t += 40 * DAY;
  w.api.pressed(PERSON, CHEST, 'chest');
  yes('and a chest left long enough holds pieces at 0%, no lower', w.count(CHEST, IRON_SWORD, 'Iron Sword (0%)') === 3);
  yes('the page and the block agree: 5% a real day', w.api.DULL_PER_DAY === 5 && w.api.DAY_MS === DAY &&
      /5% per real day/.test(page));
}
{
  const w = world();
  stocked(w);
  w.held[CHEST] = false;
  w.packs[CAVE_CHEST] = w.packs[CHEST];
  w.api.pressed(PERSON, CAVE_CHEST, 'chest');
  w.t += 10 * DAY;
  w.api.pressed(PERSON, CAVE_CHEST, 'chest');
  yes('a chest in no held building has no clock and never dulls', !w.clocks[CAVE_CHEST] && w.writes === 0);
}
{
  const w = world();
  stocked(w);
  w.api.pressed(PERSON, CHEST, 'chest');
  w.held[CHEST] = false;
  w.t += 5 * DAY;
  w.api.pressed(PERSON, CHEST, 'chest');
  yes('when the claim on the building lapses the chest\'s clock goes with it', !w.clocks[CHEST] && w.writes === 0);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (60%)' },
                     { baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (60%)', worn: true }];
  w.api.pressed(PERSON, 0x33333, 'a door');
  w.t += 30 * DAY;
  w.api.pressed(PERSON, 0x33333, 'a door');
  w.api.hit(OTHER, PERSON, 0);
  yes('a pack does not dull, and worn gear does not dull on the clock',
      w.writes === 0 && w.count(PERSON, IRON_SWORD, 'Iron Sword (60%)') === 1 &&
      w.count(PERSON, STEEL_ARMOR, 'Steel Armor (60%)') === 1);
}
{
  const w = world();
  w.held[CHEST] = true;
  w.packs[CHEST] = [{ baseId: IRON_SWORD, count: 1 }];
  w.api.pressed(PERSON, CHEST, 'chest');
  w.t += 2 * DAY;
  w.refuseWrite = true;
  w.api.pressed(PERSON, CHEST, 'chest');
  yes('a dull that cannot be written leaves the clock where it was', w.clocks[CHEST].days === 0);
  w.refuseWrite = false;
  w.api.pressed(PERSON, CHEST, 'chest');
  yes('and the next opening takes the whole of it', w.count(CHEST, IRON_SWORD, 'Iron Sword (90%)') === 1);
}

// ---------------------------------------------------------- the break chance --

yes('the page and the block agree: a 10% chance at 0%', w0BreakChance() === 0.10 && /10% chance to break on a hit/.test(page));
function w0BreakChance() { return D.BREAK_CHANCE; }
{
  const w = world({ rolls: [0.05] });
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (0%)', worn: true },
                     { baseId: IRON_SWORD, count: 1 }];
  const gone = w.api.hit(PERSON, NPC, IRON_SWORD);
  yes('worn armour at 0% breaks on a hit when the roll is under 10%',
      gone.length === 1 && w.count(PERSON, STEEL_ARMOR) === 0 && /Steel Armor broke/.test(w.said[0]));
}
{
  const w = world({ rolls: [0.5, 0.5, 0.5] });
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (0%)', worn: true }];
  w.api.hit(PERSON, NPC, IRON_SWORD);
  yes('and holds when it is not', w.count(PERSON, STEEL_ARMOR) === 1 && w.writes === 0);
}
{
  const w = world({ rolls: [0, 0, 0, 0] });
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (1%)', worn: true },
                     { baseId: ROBES, count: 1, name: 'Adept Robes (0%)' }];
  w.api.hit(PERSON, NPC, IRON_SWORD);
  yes('a worn piece above 0% never breaks, it loses 1%; and a piece at 0% in the pack and not worn never rolls',
      w.count(PERSON, STEEL_ARMOR, 'Steel Armor (0%)') === 1 && w.count(PERSON, ROBES, 'Adept Robes (0%)') === 1 &&
      w.writes === 1 && w.rolls.length === 4);
}
{
  const w = world({ rolls: [0, 0] });
  w.packs[CHEST] = [{ baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (0%)' }];
  w.held[CHEST] = true;
  w.api.hit(CHEST, PERSON, 0);
  yes('a piece at 0% sitting in a chest does not roll', w.count(CHEST, STEEL_ARMOR) === 1 && w.rolls.length === 2);
}
{
  const w = world({ rolls: [0.01, 0.01] });
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (0%)', worn: true }];
  w.packs[OTHER] = [{ baseId: GLASS_SWORD, count: 1, name: 'Glass Sword (0%)', worn: true }];
  w.api.hit(OTHER, PERSON, IRON_SWORD);
  yes('the weapon a hit is landed with rolls, at 0%', w.count(PERSON, IRON_SWORD) === 0);
  yes('the weapon of the person hit does not', w.count(OTHER, GLASS_SWORD) === 1);
}
{
  const w = world({ rolls: [0, 0] });
  w.packs[NPC] = [{ baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (0%)', worn: true }];
  w.api.hit(NPC, PERSON, 0);
  yes('only people\'s gear rolls', w.count(NPC, STEEL_ARMOR) === 1);
}
{
  const w = world({ rolls: [0.02] });
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1 },
                     { baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (0%)', worn: true }];
  // The equipment names the base and says nothing of the name.
  w.worn[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, worn: true }];
  w.api.hit(PERSON, NPC, 0);
  yes('worn read off the equipment is matched to the stack the pack has worn',
      w.count(PERSON, STEEL_ARMOR, '') === 1 && w.count(PERSON, STEEL_ARMOR, 'Steel Armor (0%)') === 0);
}

{
  const w = world({ rolls: [0.01] });
  w.packs[OTHER] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (0%)', worn: true }];
  w.api.onHit(PERSON, { type: 'form', desc: 'ff000059' }, { type: 'espm', desc: 'iron-sword' });
  yes('a hit as the engine sends it, the aggressor and weapon as descriptors, is read the same way',
      w.count(OTHER, IRON_SWORD) === 0);
}

// ---------------------------------------------------------- wear per hit --

yes('the page and the block agree: worn gear loses 1% a hit',
    D.WEAR_PER_HIT === 1 && /loses 1% of its condition on each hit that reaches it/.test(page));
{
  const w = world();
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, worn: true },
                     { baseId: GLOVES, count: 1, name: 'Fine Gloves (120%)', worn: true },
                     { baseId: IRON_SWORD, count: 1, name: 'Iron Sword (50%)', worn: true },
                     { baseId: ROBES, count: 1, name: 'Adept Robes (60%)' },
                     { baseId: GOLD_RING, count: 1, worn: true }];
  w.api.hit(PERSON, NPC, IRON_SWORD);
  yes('a hit takes 1% off the armour and the clothing the person hit wears, 120% included',
      w.count(PERSON, STEEL_ARMOR, 'Steel Armor (99%)') === 1 && w.count(PERSON, GLOVES, 'Fine Gloves (119%)') === 1);
  yes('and not off their weapon, nor what they carry and do not wear, nor a ring',
      w.count(PERSON, IRON_SWORD, 'Iron Sword (50%)') === 1 && w.count(PERSON, ROBES, 'Adept Robes (60%)') === 1 &&
      w.count(PERSON, GOLD_RING, '') === 1);
  yes('all in one write, and nothing said in the chat for a scratch', w.writes === 1 && w.said.length === 0);
  yes('worn pieces stay worn when their number changes',
      w.packs[PERSON].filter(function (e) { return e.baseId === STEEL_ARMOR; })[0].worn === true);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (50%)', worn: true },
                     { baseId: IRON_SWORD, count: 1, name: 'Iron Sword (50%)', wornLeft: true }];
  w.packs[OTHER] = [];
  w.api.hit(OTHER, PERSON, IRON_SWORD);
  yes('the weapon a hit is landed with loses 1%, one of two identical swords and not both',
      w.count(PERSON, IRON_SWORD, 'Iron Sword (49%)') === 1 && w.count(PERSON, IRON_SWORD, 'Iron Sword (50%)') === 1 &&
      w.packs[PERSON].filter(function (e) { return e.name === 'Iron Sword (49%)'; })[0].worn === true);
  w.api.hit(OTHER, PERSON, 0);
  w.api.hit(OTHER, PERSON, GOLD_RING);
  yes('a fist or a spell wears nothing of the one who threw it', w.writes === 1);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: GLASS_SWORD, count: 1, name: 'Glass Sword (80%)', worn: true },
                     { baseId: LEATHER, count: 1, worn: true }];
  w.api.hit(PERSON, NPC, IRON_SWORD, true);
  yes('a blocked hit wears the weapon that blocked it, as well as what the person hit wears',
      w.count(PERSON, GLASS_SWORD, 'Glass Sword (79%)') === 1 && w.count(PERSON, LEATHER, 'Armor Leather Cuirass (99%)') === 1);
  w.api.hit(PERSON, NPC, IRON_SWORD, false);
  yes('a hit that was not blocked does not wear the weapon of the person hit',
      w.count(PERSON, GLASS_SWORD, 'Glass Sword (79%)') === 1 && w.count(PERSON, LEATHER, 'Armor Leather Cuirass (98%)') === 1);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: GLASS_SWORD, count: 1, name: 'Glass Sword (80%)', worn: true },
                     { baseId: SHIELD, count: 1, worn: true }];
  w.api.hit(PERSON, NPC, IRON_SWORD, true);
  yes('with a shield worn, the shield took the block: it wears, and the sword does not',
      w.count(PERSON, SHIELD, 'Iron Shield (99%)') === 1 && w.count(PERSON, GLASS_SWORD, 'Glass Sword (80%)') === 1);
}
{
  const w = world({ rolls: [0.5] });
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (1%)', worn: true }];
  w.api.hit(PERSON, NPC, 0);
  w.api.hit(PERSON, NPC, 0);
  yes('a piece worn down to 0% stops there, and the next hit rolls the break chance instead',
      w.count(PERSON, STEEL_ARMOR, 'Steel Armor (0%)') === 1 && w.rolls.length === 0);
}
{
  const w = world({ rolls: [0.01] });
  w.packs[PERSON] = [{ baseId: GLASS_SWORD, count: 1, name: 'Glass Sword (0%)', worn: true }];
  w.api.hit(PERSON, NPC, IRON_SWORD, true);
  yes('a weapon at 0% that blocks a hit rolls the break chance', w.count(PERSON, GLASS_SWORD) === 0);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (84%)', worn: true }];
  // A record with an older number on the name: written before #1651, or a
  // report of an equip that crossed a rename on the way.
  w.worn[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, worn: true, name: 'Steel Armor (90%)' }];
  w.api.hit(PERSON, NPC, 0);
  yes('the equipment the client sends, with the old number on the name, is still matched to the piece',
      w.count(PERSON, STEEL_ARMOR, 'Steel Armor (83%)') === 1);
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, worn: true }];
  w.worn[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, worn: true, name: 'Steel Armor' }];
  w.api.hit(PERSON, NPC, 0);
  yes('and a plain piece the client names by its own name is the same piece',
      w.count(PERSON, STEEL_ARMOR, 'Steel Armor (99%)') === 1);
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, worn: true, name: 'Shard of Winter (50%)' }];
  w.worn[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, worn: true, name: 'Steel Armor' }];
  w.api.hit(PERSON, NPC, 0);
  yes('but a piece somebody named is not mistaken for a plain one', w.count(PERSON, STEEL_ARMOR, 'Shard of Winter (50%)') === 1);
}
{
  const w = world();
  w.packs[NPC] = [{ baseId: STEEL_ARMOR, count: 1, worn: true }];
  w.api.hit(NPC, PERSON, 0, true);
  yes('nothing an NPC wears wears down', w.writes === 0);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, worn: true }];
  w.refuseWrite = true;
  w.api.hit(PERSON, NPC, 0);
  yes('a hit whose wear cannot be written says and logs nothing', w.said.length === 0 && w.logs.length === 0);
}
{
  const w = world();
  w.packs[OTHER] = [{ baseId: IRON_SWORD, count: 1, worn: true }];
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, worn: true }];
  w.api.onHit(PERSON, { type: 'form', desc: 'ff000059' }, { type: 'espm', desc: 'iron-sword' }, true);
  yes('the engine\'s blocked flag is read off the hit as it arrives',
      w.count(OTHER, IRON_SWORD, 'Iron Sword (99%)') === 1 && w.count(PERSON, IRON_SWORD, 'Iron Sword (99%)') === 1);
}

// ---------------------------------------------------------- a drop ---------

// The engine keeps a dropped piece's extra through the pickup (#1719), so the
// block no longer watches drops, and pressing a dropped piece writes nothing.
const DROPPED = 0xff00a001;
{
  const w = world();
  yes('the durability block has no drop watcher any more', typeof w.api.dropped === 'undefined');
  w.cells[DROPPED] = 'WhiterunBreezehome';
  w.packs[OTHER] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (40%)' }];
  w.api.pressed(OTHER, DROPPED, 'iron-sword');
  w.flush();
  yes('a pickup off the ground is left as the engine gave it',
      w.count(OTHER, IRON_SWORD, 'Iron Sword (40%)') === 1 && w.writes === 0);
}

// ---------------------------------------------------------- the wiring ------

const code = gm.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
function between(src, start, end) { return slice(src, start, end) || ''; }
const onActivate = between(code, "mp.onActivate = guard('onActivate'", '\n});');
const onDrop = between(code, "mp.onDropItem = guard('onDropItem'", '\n});');
const recipeless = between(code, 'function recipelessCraft(actorId, craftedItemBaseId, workbenchId, effects) {', '\n}\n');
yes('a press reaches the durability block, and no container is remembered as a box any more (#2298)',
    /wear\.pressed\(casterRefrId, refrId, baseDesc\)/.test(onActivate) &&
    onActivate.indexOf('touchedBox') === -1);
const dropContext = { mp: {}, guard: (name, fn) => fn, log() {},
  auditPerson: () => '', auditItem: () => '', auditCell: () => '',
  globalThis: { __thornswoodWear: new Proxy({}, { get() { throw Error('drop reached durability'); } }) } };
vm.createContext(dropContext);
vm.runInContext(require('../../tests/fixtures/ordinary-quest-items') + onDrop, dropContext);
yes('ordinary drops return no override and never reach the durability block',
    onDrop !== '' && !/wear\.dropped\(/.test(onDrop) &&
    dropContext.mp.onDropItem(101, IRON_SWORD, 1) === undefined);
yes('the drop watcher refuses nothing else but the locked pair of Prisoner\'s Cuffs (#2573)',
    (onDrop.replace(/if\(questItemBlocked\(baseId\)\)return false;/, '')
      .replace(/if \(cuffsDrop && !cuffsDrop\.mayLetGo\(actorId, baseId, count\)\) \{ return false; \}/, '')
      .match(/\breturn\b/g) || []).length === 0);
const onHitLines = gm.split('\n').filter(function (l) { return /^mp\['onPapyrusEvent:OnHit'\] = guard\('onPapyrusEvent:OnHit', function/.test(l); });
yes('a hit reaches it through the one OnHit handler, under guard(), beside the warrior maneuvers, with the blocked flag',
    onHitLines.length === 1 &&
    /wear\.onHit\(targetId, aggressor, source, blocked\)/.test(between(code, "mp['onPapyrusEvent:OnHit']", '\n});')));
const temper = recipeless.indexOf('if (tempering) {');
yes('a temper at the wheel or the armour table is refused before anything is credited',
    temper !== -1 && /if \(tempering\) \{[\s\S]*?return false;\s*\}/.test(recipeless) &&
    (recipeless.indexOf('credit') === -1 || recipeless.indexOf('credit') > temper));
const wordsLine = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
const playerLine = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
let WORDS = [], PLAYER = [];
try { WORDS = new Function('return ' + wordsLine[1])(); PLAYER = new Function('return ' + playerLine[1])(); } catch (e) { }
yes('/repair is a word the server answers for the key and the panel, and nobody is told about it',
    WORDS.indexOf('/repair') !== -1 && PLAYER.indexOf('/repair') === -1 &&
    /if \(word === '\/repair'\) \{[\s\S]*?wear\.panel\(actorId, parts\.slice\(1\)\)/.test(code));
{
  // Every string literal in the gamemode that a person could read: none of
  // them names /repair. The WORDS list and the router compare against it.
  const lits = (gm.match(/'(?:[^'\\\n]|\\.)*'/g) || []).filter(function (l) { return l.indexOf('/repair') !== -1; });
  yes('no line a person reads tells them to type /repair', lits.length === 2 &&
      lits.every(function (l) { return l === "'/repair'"; }));
}
{
  const front = fs.readFileSync(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'), 'utf8');
  const panelPage = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-repair.js'), 'utf8');
  const kitItems = /const KIT_ITEMS = \[(0x[0-9a-f]+), (0x[0-9a-f]+), (0x[0-9a-f]+)\];/.exec(front);
  yes('the client asks for the same three kit records the server names',
      !!kitItems && ['weapon', 'armour', 'clothing'].every(function (k, i) {
        return parseInt(kitItems[i + 1], 16) === parseInt(KITS[k].item.split(':')[0], 16);
      }) && /const KIT_FILE = 'Thornswood-Content\.esp';/.test(front));
  yes('the inventory key sends /repair, shuts the inventory and is armed only with the inventory open',
      /if \(e\.code === MOLD_KEY && repairPress\(\)\) \{ return; \}/.test(front) &&
      /function repairPress\(\) \{[\s\S]*?isMenuOpen\(INVENTORY_MENU\)[\s\S]*?closeMenu\(INVENTORY_MENU\)[\s\S]*?tellServer\('\/repair'\)/.test(front));
  yes('the panel is loaded, claims the keyboard while it is open, and the cap can close it',
      front.indexOf("'thornswood-repair.js'") !== -1 && /repair: 'thornswoodRepair'/.test(front) &&
      /'repair:opened'\) \{ T\.claimFocus\('repair', true\)/.test(front) &&
      /'repair:closed'\) \{ T\.claimFocus\('repair', false\)/.test(front));
  yes('the panel\'s button sends the row back as /repair mend, and the server publishes the view the page reads',
      /net\('\/repair mend ' \+ row\.base \+ ' ' \+ row\.cond \+ ' ' \+ row\.name\)/.test(panelPage) &&
      /window\.thornswoodRepair = \{/.test(panelPage) &&
      /var PANEL_PROPERTY = 'thornswoodRepairView';/.test(block) &&
      /window\.thornswoodRepair\.setData\(d\)/.test(block));
}
{
  const ap = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'apprenticeship.md'), 'utf8').split(CR).join('');
  yes('the apprenticeship page agrees: the sister half never repairs to 120%, at any rank',
      /The\s+sister\s+half\s+never\s+gives\s+it,\s+at\s+any\s+rank/.test(ap) && !/taken the sister half\s+on far enough to be that half/.test(ap) &&
      /The\s+sister\s+half\s+is\s+never\s+it,\s+at\s+any\s+rank/.test(page));
}
yes('the cut list still holds the temper rows, so an event can bring one back',
    /Tempering rows, the grindstone and the armour table, are in this file/.test(
      fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'cut-items.md'), 'utf8')));

// ------------------------------------------- the record follows (#1651) --
//
// The owner's game dresses them at login by matching each worn entry of the
// equipment record to the pack by name, exactly, since #1651. So a rename in
// the pack renames the record's entry in the same step, and a record written
// before #1651 is put right as its owner logs in.

function recordOf(entries) { return { inv: { entries: entries }, numChanges: 3 }; }
function recName(w, id, i) { return w.records[id].inv.entries[i].name; }
{
  const w = world();
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1 }, { baseId: IRON_SWORD, count: 1, name: 'Iron Sword (50%)' },
                     { baseId: ROBES, count: 1, name: 'Adept Robes (60%)' }];
  w.records[PERSON] = recordOf([{ baseId: STEEL_ARMOR, count: 1, worn: true, name: 'Steel Armor' },
                                { baseId: IRON_SWORD, count: 1, worn: true, name: 'Iron Sword (50%)' },
                                { baseId: ROBES, count: 1, name: 'Adept Robes (60%)' }]);
  w.api.hit(PERSON, NPC, IRON_SWORD, true);
  yes('a hit renames the worn pieces in the record in the same step as the pack',
      w.count(PERSON, STEEL_ARMOR, 'Steel Armor (99%)') === 1 && recName(w, PERSON, 0) === 'Steel Armor (99%)' &&
      w.count(PERSON, IRON_SWORD, 'Iron Sword (49%)') === 1 && recName(w, PERSON, 1) === 'Iron Sword (49%)');
  yes('in one write of the record, changing nothing but names, and its counter left alone',
      w.recordWrites === 1 && w.records[PERSON].numChanges === 3 && w.records[PERSON].inv.entries[0].worn === true);
  yes('what is carried and not worn is left as the record had it', recName(w, PERSON, 2) === 'Adept Robes (60%)');
  w.api.hit(PERSON, NPC, 0);
  yes("the next hit finds the piece by the record's new name and renames it again",
      w.count(PERSON, STEEL_ARMOR, 'Steel Armor (98%)') === 1 && recName(w, PERSON, 0) === 'Steel Armor (98%)');
}
{
  // Two swords of one base, one worn. The pack keeps them as one stack until
  // a hit splits them; the record names the worn one.
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 2, name: 'Iron Sword (85%)' }];
  w.records[PERSON] = recordOf([{ baseId: IRON_SWORD, count: 1, worn: true, name: 'Iron Sword (85%)' },
                                { baseId: IRON_SWORD, count: 1, name: 'Iron Sword (85%)' }]);
  w.packs[OTHER] = [];
  w.api.hit(OTHER, PERSON, IRON_SWORD);
  w.api.hit(OTHER, PERSON, IRON_SWORD);
  yes("of two swords of one base, the record's worn one is the one worn down, hit after hit",
      w.count(PERSON, IRON_SWORD, 'Iron Sword (83%)') === 1 && w.count(PERSON, IRON_SWORD, 'Iron Sword (85%)') === 1 &&
      recName(w, PERSON, 0) === 'Iron Sword (83%)' && recName(w, PERSON, 1) === 'Iron Sword (85%)');
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  w.records[PERSON] = recordOf([{ baseId: IRON_SWORD, count: 1, worn: true, name: 'Iron Sword (40%)' }]);
  const r = w.api.repairWithKit(PERSON, row(IRON_SWORD, 40, 'Iron Sword'));
  yes('a repair of a worn piece to 100% renames it plain in the record too',
      r.ok && w.count(PERSON, IRON_SWORD, '') === 1 && recName(w, PERSON, 0) === undefined && w.recordWrites === 1);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (40%)' }, { baseId: WEAPON_KIT, count: 1 }];
  w.records[PERSON] = recordOf([{ baseId: STEEL_ARMOR, count: 1, worn: true }]);
  w.api.repairWithKit(PERSON, row(IRON_SWORD, 40, 'Iron Sword'));
  yes('a repair of a piece nobody wears writes nothing to the record', w.recordWrites === 0);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (80%)' }];
  w.records[PERSON] = recordOf([{ baseId: STEEL_ARMOR, count: 1, worn: true, name: 'Steel Armor (80%)' }]);
  w.refuseRecord = true;
  w.api.hit(PERSON, NPC, 0);
  yes('when the engine refuses the record (an engine before #1651), the hit still wears the pack',
      w.count(PERSON, STEEL_ARMOR, 'Steel Armor (79%)') === 1 && recName(w, PERSON, 0) === 'Steel Armor (80%)');
}

// A record written before #1651, at login.
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (40%)' },
                     { baseId: IRON_SWORD, count: 1, name: 'Iron Sword (85%)' },
                     { baseId: STEEL_ARMOR, count: 1, name: 'Steel Armor (70%)' },
                     { baseId: GOLD_RING, count: 1 }];
  w.records[PERSON] = recordOf([{ baseId: IRON_SWORD, count: 1, worn: true, name: 'Iron Sword (90%)' },
                                { baseId: STEEL_ARMOR, count: 1, worn: true, name: 'Steel Armor (70%)' },
                                { baseId: GOLD_RING, count: 1, worn: true, name: 'Gold Ring' },
                                { baseId: IRON_SWORD, count: 1, name: 'Iron Sword (60%)' }]);
  const n = w.api.loading(PERSON);
  yes("at login a worn piece the record names at an old condition takes the pack's name",
      n === 1 && recName(w, PERSON, 0) === 'Iron Sword (85%)');
  yes("of an 85% and a 40% sword, the record's 90% is the 85% one, the nearest", recName(w, PERSON, 0) === 'Iron Sword (85%)');
  yes('a worn piece the record already names right, a ring, and what is not worn are left alone',
      recName(w, PERSON, 1) === 'Steel Armor (70%)' && recName(w, PERSON, 2) === 'Gold Ring' &&
      recName(w, PERSON, 3) === 'Iron Sword (60%)');
  yes('in one write, said in the log', w.recordWrites === 1 && w.logs.some(function (l) { return /equipment record/.test(l); }));
  w.recordWrites = 0;
  yes('and the next login finds nothing to put right', w.api.loading(PERSON) === 0 && w.recordWrites === 0);
}
{
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1 }];
  w.records[PERSON] = recordOf([{ baseId: IRON_SWORD, count: 1, worn: true, name: 'Iron Sword' }]);
  yes('a plain piece the record names by its own name is right as it is', w.api.loading(PERSON) === 0 && w.recordWrites === 0);
  w.records[PERSON] = recordOf([{ baseId: IRON_SWORD, count: 1, worn: true, name: 'Iron Sword (90%)' }]);
  w.api.loading(PERSON);
  yes('a record naming a piece since mended to 100% loses the number', recName(w, PERSON, 0) === undefined);
}
{
  // Two worn swords, one in each hand, both named at old numbers; the pack
  // has two stacks. Each stack answers for one of them.
  const w = world();
  w.packs[PERSON] = [{ baseId: IRON_SWORD, count: 1, name: 'Iron Sword (30%)' },
                     { baseId: IRON_SWORD, count: 1, name: 'Iron Sword (70%)' }];
  w.records[PERSON] = recordOf([{ baseId: IRON_SWORD, count: 1, worn: true, name: 'Iron Sword (75%)' },
                                { baseId: IRON_SWORD, count: 1, wornLeft: true, name: 'Iron Sword (35%)' }]);
  w.api.loading(PERSON);
  yes('two worn pieces of one base each take a stack of their own, the nearest',
      recName(w, PERSON, 0) === 'Iron Sword (70%)' && recName(w, PERSON, 1) === 'Iron Sword (30%)');
}
yes("the engine's hook before a character is handed over is the block's", /g\.__thornswoodSpawn\.loading = function/.test(block));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
