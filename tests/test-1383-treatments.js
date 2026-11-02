// test-1383-treatments.js
//
// #1383, the second half: what opens a wound in the world and what treats
// it. Patrick's answers on #1383 (4 October): a cut is an unblocked power or
// sneak attack with a blade or an axe, or an arrow or a bolt that lands; a
// break is an unblocked power attack with a mace or a warhammer, the arm or
// the leg at even odds; a bite is an unblocked hit from an animal that bites.
// The treatments are docs/systems/injury.md's: torn cloth (no item), a
// bandage (a Haberdasher's, at the loom), a splint (a Woodwright's, at the
// kiln), a poultice and a physicker's remedy (a Physicker's, novice and
// advanced), and a physicker setting a bone. Your own from the inventory,
// somebody else's from the look prompt, both through one panel.
//
// It drives the REAL injury and disease block out of gamemode.js over a fake
// mp, a fake clock and the test's own dice, reads the records out of
// Thornswood-Content.esp as bytes, and runs the panel page and the property
// scripts against stand-ins for the page and the client.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
function read(...bits) { return fs.readFileSync(path.join(REPO_DIR, ...bits), 'utf8').split(CR).join(''); }
const src = require('./gamemode-tables.js').joined(read('game', 'gamemode.js'));
const front = read('game', 'plugins', 'thornswood-front.js');
const page = read('game', 'ui', 'thornswood-treat.js');
const injury = read('docs', 'systems', 'injury.md');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j + b.length) : null;
}

const HURT_SRC = slice('// ==== thornswood injury and disease ====', '// ==== end thornswood injury and disease ====');
const PROG_SRC = slice('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const KILL_SRC = slice('const WARRIOR_KILL = {', '\n};\n');
yes('the injury, progression and warrior kill blocks are in the gamemode', !!HURT_SRC && !!PROG_SRC && !!KILL_SRC);
const WARRIOR_KILL = KILL_SRC ? new Function(KILL_SRC + '\nreturn WARRIOR_KILL;')() : null;
const progBox = {};
if (PROG_SRC) { new Function('globalThis', 'console', PROG_SRC)(progBox, { log: function () { } }); }
const P = progBox.__thornswoodProgression;

// ------------------------------------------------------------- the records
//
// The plugin read as bytes, the way test-1384-condition.js reads the kits.
function readPlugin(buf) {
  const recs = {};
  const masters = [];
  const headSize = buf.readUInt32LE(4);
  for (let p = 24; p + 6 <= 24 + headSize;) {
    const t = buf.toString('latin1', p, p + 4), s = buf.readUInt16LE(p + 4);
    if (t === 'MAST') { masters.push(buf.toString('latin1', p + 6, p + 6 + s).replace(/\0+$/, '')); }
    p += 6 + s;
  }
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
  walk(24 + headSize, buf.length);
  return { recs: recs, masters: masters };
}
function sub(rec, tag) { return rec ? rec.subs.filter(function (x) { return x.tag === tag; }) : []; }
function zs(b) { return b.toString('latin1').replace(/\0+$/, ''); }
const plugin = readPlugin(fs.readFileSync(path.join(REPO_DIR, 'game', 'content', 'Thornswood-Content.esp')));
function edidOf(fid) { const r = plugin.recs[fid]; const e = sub(r, 'EDID'); return e.length ? zs(e[0].data) : ''; }

const TUNDRA_COTTON = 0x3f7f8, FIREWOOD = 0x6f993, LEATHER_STRIPS = 0x800e4, GARLIC = 0x34d22,
      MUDCRAB_CHITIN = 0x6bc00, BLUE_MOUNTAIN_FLOWER = 0x77e1c;
const LOOM = 0x016ce000, KILN = 0x0501547f, LAB = 0x05042e6b;
const MADE = [
  { k: 'bandage', item: 0x050154c0, name: 'Bandage', recipe: 0x050154c4, edid: 'ThornswoodRecipeBandage', bench: LOOM,
    inputs: [[TUNDRA_COTTON, 1]], owner: ['Tailor', 'Haberdasher'],
    words: '| Bandage | 1 Tundra Cotton | Loom | Tailor, Haberdasher, novice |' },
  { k: 'splint', item: 0x050154c1, name: 'Splint', recipe: 0x050154c5, edid: 'ThornswoodRecipeSplint', bench: KILN,
    inputs: [[FIREWOOD, 1], [LEATHER_STRIPS, 1]], owner: ['Woodworker', 'Woodwright'],
    words: '| Splint | 1 Firewood, 1 Leather Strips | Kiln | Woodworker, Woodwright, novice |' },
  { k: 'poultice', item: 0x050154c2, name: 'Poultice', recipe: 0x050154c6, edid: 'ThornswoodRecipePoultice', bench: LAB,
    inputs: [[TUNDRA_COTTON, 1], [GARLIC, 1]], owner: ['Alchemist', 'Physicker'],
    words: '| Poultice | 1 Tundra Cotton, 1 Garlic | Alchemy lab | Alchemist, Physicker, novice |' },
  { k: 'remedy', item: 0x050154c3, name: 'Physicker\'s Remedy', recipe: 0x050154c7, edid: 'ThornswoodRecipeRemedy', bench: LAB,
    inputs: [[MUDCRAB_CHITIN, 1], [BLUE_MOUNTAIN_FLOWER, 1]], owner: ['Alchemist', 'Physicker'],
    words: '| Physicker\'s Remedy | 1 Mudcrab Chitin, 1 Blue Mountain Flower | Alchemy lab | Alchemist, Physicker, advanced |' }
];
const recipeTable = read('scripts', 'dev', 'Build-RecipeTable.ps1');
// RECIPE_OWNER's entries, which Build-RecipeTable.ps1 reads from records/recipe-owners.json.
const named = JSON.parse(read('records', 'recipe-owners.json')).owner;
const adder = read('scripts', 'mods', 'Add-ContentRecords.py');
MADE.forEach(function (m) {
  const misc = plugin.recs[m.item];
  yes('the plugin carries the ' + m.name + ' as a MISC under that name',
      !!misc && misc.tag === 'MISC' && sub(misc, 'FULL').length === 1 && zs(sub(misc, 'FULL')[0].data) === m.name);
  const cobj = plugin.recs[m.recipe];
  const ins = sub(cobj, 'CNTO').map(function (c) { return [c.data.readUInt32LE(0), c.data.readUInt32LE(4)]; });
  yes('and ' + m.edid + ' makes one out of what the injury page\'s table says, at that bench',
      !!cobj && cobj.tag === 'COBJ' && edidOf(m.recipe) === m.edid &&
      sub(cobj, 'CNAM')[0].data.readUInt32LE(0) === m.item &&
      sub(cobj, 'BNAM')[0].data.readUInt32LE(0) === m.bench &&
      sub(cobj, 'COCT')[0].data.readUInt32LE(0) === m.inputs.length &&
      JSON.stringify(ins) === JSON.stringify(m.inputs) && injury.indexOf(m.words) !== -1);
  yes('and records/recipe-owners.json names it to ' + m.owner.join('/') + ', so the rebuilt table gates it',
      !!named[m.edid] && named[m.edid].Owner === m.owner[0] && named[m.edid].Half === m.owner[1]);
  // Written by the tool from its own numbers (#2553): a writer call with the
  // record's constant and its editor id.
  yes('and Add-ContentRecords.py is what adds both records',
      new RegExp("\\(\\s*[A-Z_]+,\\s*'" + m.edid + "',").test(adder) &&
      new RegExp("\\(\\s*[A-Z_]+,\\s*'" + m.edid.replace('Recipe', 'Misc') + "',").test(adder));
});
yes('the loom is named through Update.esm, this plugin\'s master 01, as the injected MCE_CraftingLoom 6ce000',
    plugin.masters[1] === 'Update.esm' && /'6ce000:Update\.esm': 'the loom'/.test(src));
yes('the kiln is the plugin\'s ThornswoodCraftingCharcoalKiln keyword',
    plugin.recs[KILN] && plugin.recs[KILN].tag === 'KYWD' && edidOf(KILN) === 'ThornswoodCraftingCharcoalKiln');
{
  // The lab: the keyword, and a create-object bench (WBDT type 1) carrying it.
  let bench = null;
  Object.keys(plugin.recs).forEach(function (f) {
    const r = plugin.recs[f];
    if (r.tag !== 'FURN') { return; }
    const kw = sub(r, 'KWDA');
    const has = kw.length && Array.from({ length: kw[0].data.length / 4 }, function (_, i) { return kw[0].data.readUInt32LE(i * 4); })
      .indexOf(LAB) !== -1;
    if (has) { bench = r; }
  });
  yes('the alchemy lab is the plugin\'s ThornswoodCraftingAlchemy, carried by a create-object bench it places',
      plugin.recs[LAB] && plugin.recs[LAB].tag === 'KYWD' && edidOf(LAB) === 'ThornswoodCraftingAlchemy' &&
      !!bench && sub(bench, 'WBDT')[0].data[0] === 1);
}
yes('the Physicker is no longer named as a half with no recipes, and the Blightbrewer still is',
    !/'Alchemist\/Physicker'\s*=\s*@\{ Crafts/.test(recipeTable) && /'Alchemist\/Blightbrewer'\s*=\s*@\{ Crafts/.test(recipeTable));

// ---------------------------------------------------------------- the rig

const SWORD = 0x1001, DAGGER = 0x1002, BATTLEAXE = 0x1003, WARHAMMER = 0x1004, MACE = 0x1005, BOW = 0x1006,
      GREAT_UNKNOWN = 0x1007, SPIT = 0x1008, FIST = 0x1f4, CROSSBOW = 0x1009;
const KW = { 0x2001: 'WeapTypeSword', 0x2002: 'WeapTypeBattleaxe', 0x2003: 'WeapTypeWarhammer', 0x2004: 'WeapTypeBow' };
function weap(anim, kws) {
  const kwda = [];
  (kws || []).forEach(function (k) { kwda.push(k & 0xff, (k >> 8) & 0xff, (k >> 16) & 0xff, (k >>> 24) & 0xff); });
  const fields = [{ type: 'DNAM', data: [anim, 0, 0, 0] }];
  if (kwda.length) { fields.push({ type: 'KWDA', data: kwda }); }
  return { record: { type: 'WEAP', fields: fields }, toGlobalRecordId: function (l) { return l; } };
}
const RECORDS = {};
RECORDS[SWORD] = weap(1, [0x2001]);
RECORDS[DAGGER] = weap(2);
RECORDS[BATTLEAXE] = weap(6, [0x2002]);
RECORDS[WARHAMMER] = weap(6, [0x2003]);
RECORDS[MACE] = weap(4);
RECORDS[BOW] = weap(7, [0x2004]);
RECORDS[CROSSBOW] = weap(9);
RECORDS[GREAT_UNKNOWN] = weap(6);
RECORDS[FIST] = weap(0);
RECORDS[SPIT] = { record: { type: 'SPEL', fields: [] } };
Object.keys(KW).forEach(function (k) {
  // One keyword answers by editorId, the rest by their EDID field, which is
  // the two ways the engine has been seen to give it.
  RECORDS[k] = Number(k) === 0x2001 ? { record: { type: 'KYWD', editorId: KW[k], fields: [] } }
    : { record: { type: 'KYWD', fields: [{ type: 'EDID', data: Array.from(Buffer.from(KW[k] + '\0', 'latin1')) }] } };
});

function rig() {
  const G = {};
  const props = {};
  const extra = {};
  const said = [];
  const clock = { now: 1700000000000 };
  const dice = { next: [] };
  const later = [];
  const ids = {};
  let nextId = 0x5000;
  function idOf(desc) { if (!ids[desc]) { ids[desc] = nextId++; } return ids[desc]; }
  const M = Object.create(Math);
  M.random = function () { return dice.next.length ? dice.next.shift() : 0.999; };
  const made = {};
  function ex(id) { return (extra[id] = extra[id] || { pack: [], health: 1, pos: [0, 0, 0], cell: '3c:Skyrim.esm' }); }
  const mp = {
    makeProperty: function (name, opts) { made[name] = opts; },
    getDescFromId: function (id) { return 'ff' + id.toString(16) + ':Runtime'; },
    getIdFromDesc: function (desc) { return parseInt(String(desc), 16) || 0; },
    lookupEspmRecordById: function (id) { return RECORDS[id] || null; },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return Object.keys(extra).map(Number).filter(function (id) { return extra[id].pid; }); }
      const e = ex(id);
      if (key === 'profileId') { return e.pid || 0; }
      if (key === 'isDead') { return !!e.dead; }
      if (key === 'worldOrCellDesc') { return e.cell; }
      if (key === 'pos') { return e.pos; }
      if (key === 'percentages') { return { health: e.health, magicka: 1, stamina: 1 }; }
      if (key === 'inventory') { return { entries: e.pack.map(function (x) { return Object.assign({}, x); }) }; }
      return props[id] ? props[id][key] : undefined;
    },
    set: function (id, key, v) {
      if (key === 'inventory') { ex(id).pack = JSON.parse(JSON.stringify(v.entries)); return; }
      if (!props[id]) { props[id] = {}; }
      props[id][key] = JSON.parse(JSON.stringify(v));
    },
    callPapyrusFunction: function () { }
  };
  function packCount(actorId, desc) {
    const id = idOf(desc);
    return ex(actorId).pack.reduce(function (n, x) { return n + (x.baseId === id ? x.count : 0); }, 0);
  }
  function takeItem(actorId, desc, n) {
    const id = idOf(desc);
    const pack = ex(actorId).pack;
    for (let i = 0; i < pack.length; i++) {
      if (pack[i].baseId !== id) { continue; }
      if (pack[i].count < n) { return false; }
      pack[i].count -= n;
      if (!pack[i].count) { pack.splice(i, 1); }
      return true;
    }
    return false;
  }
  function raceEdidOf(id) { return ex(id).race || ''; }
  const D = { now: function () { return clock.now; } };
  const names = ['globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval', 'setTimeout',
                 'guard', 'notify', 'say', 'Math', 'idOf', 'BENCH_BY_BASE', 'packCount', 'takeItem',
                 'raceEdidOf', 'WARRIOR_KILL'];
  new Function(names.join(','), HURT_SRC).apply(null, [
    G, mp, D, { log: function () { } }, function () { return 0; }, function () { },
    function (f, ms) { later.push(f); return 0; },
    function (n, f) { return f; },
    function (id, line) { said.push({ id: id, line: line }); }, function () { },
    M, idOf, {}, packCount, takeItem, raceEdidOf, WARRIOR_KILL]);
  const state = {};
  G.__thornswoodProgression = P;
  G.__thornswoodCharacter = {
    stateOf: function (id) { return state[id] || P.fresh(); },
    writeState: function () { }
  };
  G.__thornswoodSocial = {
    nameOfPerson: function (id) { return ex(id).name || 'somebody'; },
    findPerson: function (who) {
      const n = parseInt(who, 16);
      if (extra[n] && extra[n].pid) { return { actorId: n, why: '' }; }
      return { actorId: 0, why: 'Nobody here by that name.' };
    }
  };
  const H = G.__thornswoodHurt;
  return {
    G: G, H: H, mp: mp, made: made, props: props, clock: clock, dice: dice, said: said, state: state,
    idOf: idOf,
    person: function (id, name) { const e = ex(id); e.pid = id; e.name = name || ('P' + id.toString(16)); return id; },
    npc: function (id, race) { ex(id).race = race; return id; },
    set: function (id, k, v) { ex(id)[k] = v; },
    give: function (id, what, n) { ex(id).pack.push({ baseId: idOf(H.TREAT[what].item), count: n || 1 }); },
    has: function (id, what) { return packCount(id, H.TREAT[what].item); },
    rec: function (id) { return H.read(id); },
    minutes: function (m) { clock.now += m * 60000; },
    tick: function () { H.tick(); },
    // The next turn, the way setTimeout(…, 0) would, with health at what the blow left.
    turn: function (id, health) { if (id) { ex(id).health = health; } const all = later.splice(0); all.forEach(function (f) { f(); }); },
    lines: function (id) { return said.filter(function (s) { return s.id === id; }).map(function (s) { return s.line; }); },
    view: function (id) { return props[id] ? props[id].thornswoodTreatView : null; }
  };
}
function wounds(r, id, k) { return r.rec(id).wounds.filter(function (w) { return w.k === k; }); }
function form(id) { return { type: 'form', desc: id.toString(16) }; }

if (HURT_SRC && P && WARRIOR_KILL) {
  // ------------------------------------------------------- what bites
  {
    const r = rig();
    const races = r.H.bitingRaces();
    const words = {};
    Object.keys(races).forEach(function (k) { words[races[k]] = true; });
    yes('all ten animals Patrick named bite, each through the warrior block\'s own races (' +
        Object.keys(races).length + ' races)',
        r.H.BITERS.length === 10 && r.H.BITERS.every(function (w) { return words[w]; }) &&
        ['wolf', 'dog', 'bear', 'sabre cat', 'skeever', 'spider', 'chaurus', 'troll', 'horker', 'slaughterfish']
          .every(function (w) { return r.H.BITERS.indexOf(w) !== -1; }));
    yes('a wolf, a husky, a frost troll and a slaughterfish bite; a fox, a mudcrab and a person do not',
        !!races.wolfrace && !!races.dlc1huskybarerace && !!races.trollfrostrace && !!races.slaughterfishrace &&
        !races.foxrace && !races.mudcrabrace && !races.nordrace);
  }

  // ------------------------------------------------------- the weapon kinds
  {
    const r = rig();
    const k = r.H.weaponKind;
    yes('a sword is a blade by its keyword, a dagger by its animation, a battleaxe an axe, a warhammer and a mace blunt',
        k(SWORD) === 'blade' && k(DAGGER) === 'blade' && k(BATTLEAXE) === 'axe' && k(WARHAMMER) === 'blunt' && k(MACE) === 'blunt');
    yes('a bow and a crossbow are a bow, a spell is a spell, a fist is nothing',
        k(BOW) === 'bow' && k(CROSSBOW) === 'bow' && k(SPIT) === 'spell' && k(FIST) === '');
    yes('a two handed axe swing with no keyword is nothing, because a battleaxe and a hammer swing alike',
        k(GREAT_UNKNOWN) === '');
  }

  // ------------------------------------------------------- the blows
  function hitWith(r, me, by, source, flags, healthAfter) {
    flags = flags || {};
    r.H.blow(me, form(by), form(source), null, !!flags.power, !!flags.sneak, !!flags.bash, !!flags.blocked);
    // Each blow takes a little more, unless the case says what it left.
    r.turn(me, healthAfter === undefined ? r.mp.get(me, 'percentages').health - 0.05 : healthAfter);
  }
  {
    const r = rig();
    const me = r.person(0x20, 'Ysolda');
    const bandit = r.npc(0x30, 'NordRace');
    hitWith(r, me, bandit, SWORD, {});
    yes('a plain swing with a sword opens nothing', r.rec(me).wounds.length === 0);
    hitWith(r, me, bandit, SWORD, { power: true }, 0.6);
    const c = wounds(r, me, 'cut');
    yes('a power attack with a sword that lands opens a bleeding cut, and says so',
        c.length === 1 && c[0].bleed && r.lines(me).indexOf('You are cut and bleeding.') !== -1);
    yes('and the record says there is something to tend', r.mp.get(me, 'thornswoodHurt').care === 1);
  }
  {
    const r = rig();
    const me = r.person(0x20);
    const b = r.npc(0x30, 'NordRace');
    hitWith(r, me, b, DAGGER, { sneak: true });
    hitWith(r, me, b, BATTLEAXE, { power: true });
    hitWith(r, me, b, BOW, {});
    hitWith(r, me, b, CROSSBOW, {});
    yes('a sneak attack with a dagger, a power attack with a battleaxe, an arrow and a bolt each cut',
        wounds(r, me, 'cut').length === 4 && wounds(r, me, 'break').length === 0);
  }
  {
    const r = rig();
    const me = r.person(0x20);
    const b = r.npc(0x30, 'NordRace');
    hitWith(r, me, b, SWORD, { power: true, blocked: true });
    hitWith(r, me, b, BOW, { blocked: true });
    hitWith(r, me, b, SWORD, { power: true, bash: true });
    hitWith(r, me, b, SPIT, { power: true });
    hitWith(r, me, b, FIST, { power: true });
    hitWith(r, me, b, GREAT_UNKNOWN, { power: true });
    hitWith(r, me, b, WARHAMMER, {});
    yes('blocked, a bash, a spell, a fist, an unknown two hander and a hammer without a power attack open nothing',
        r.rec(me).wounds.length === 0);
  }
  {
    const r = rig();
    const me = r.person(0x20);
    const b = r.npc(0x30, 'OrcRace');
    r.dice.next = [0.3];
    hitWith(r, me, b, WARHAMMER, { power: true });
    r.dice.next = [0.7];
    hitWith(r, me, b, MACE, { power: true });
    const br = wounds(r, me, 'break');
    yes('a power attack with a warhammer or a mace breaks a bone, the arm or the leg at even odds',
        br.length === 2 && br[0].limb === 'arm' && br[1].limb === 'leg' &&
        r.lines(me).indexOf('Your arm is broken.') !== -1 && r.lines(me).indexOf('Your leg is broken.') !== -1);
  }
  {
    const r = rig();
    const me = r.person(0x20);
    const wolf = r.npc(0x31, 'WolfRace');
    const skeever = r.npc(0x32, 'SkeeverRace');
    const spider = r.npc(0x33, 'FrostbiteSpiderRaceGiant');
    const fox = r.npc(0x34, 'FoxRace');
    hitWith(r, me, wolf, FIST, {});
    hitWith(r, me, skeever, 0, {});
    hitWith(r, me, spider, SPIT, {});
    hitWith(r, me, fox, FIST, {});
    hitWith(r, me, wolf, FIST, { blocked: true });
    const bites = wounds(r, me, 'bite');
    yes('a wolf and a skeever bite; a spider\'s spit, a fox and a blocked wolf do not',
        bites.length === 2 && bites[0].bleed && r.lines(me).indexOf('You are bitten and bleeding.') !== -1);
  }
  {
    const r = rig();
    const me = r.person(0x20);
    const b = r.npc(0x30, 'NordRace');
    hitWith(r, me, b, SWORD, { power: true }, 1);
    yes('a blow that took no health opens nothing (the engine threw it away)', r.rec(me).wounds.length === 0);
    hitWith(r, me, b, SWORD, { power: true }, 0);
    yes('a blow that killed opens nothing: it is the death', r.rec(me).wounds.length === 0);
    r.set(me, 'dead', true);
    hitWith(r, me, b, SWORD, { power: true }, 0.4);
    yes('nor one on somebody already down dead', r.rec(me).wounds.length === 0);
    const npc = r.npc(0x40, 'NordRace');
    hitWith(r, npc, me, SWORD, { power: true }, 0.4);
    yes('an NPC hit carries no wound record', r.rec(npc).wounds.length === 0);
  }
  yes('the hit handler hands the blow every flag it has, on its own',
      /if \(hurt && hurt\.blow\) \{\s*try \{ hurt\.blow\(targetId, aggressor, source, projectile, power, sneak, bash, blocked\); \}/.test(src));

  // ------------------------------------------------------- the treatments
  function cutOn(r, id) { r.H.wound(id, 'cut', '', r.clock.now); return wounds(r, id, 'cut')[0]; }
  {
    const r = rig();
    const me = r.person(0x20);
    cutOn(r, me);
    yes('a cut bleeds 2 a second', r.H.bleedRate(r.rec(me)) === 2);
    let t = r.H.treat(me, me, 'cloth');
    yes('torn cloth needs no item and slows the bleed to 1', t.ok && r.H.bleedRate(r.rec(me)) === 1 &&
        /It slows\. It has not stopped\./.test(t.line));
    t = r.H.treat(me, me, 'cloth');
    yes('torn cloth twice is refused, and says a bandage stops it', !t.ok && /already bound/.test(t.line));
    r.dice.next = [0.35];
    r.minutes(10); r.tick();
    yes('torn cloth does not change the fever chance: 40% still catches at 0.35',
        r.rec(me).ills.some(function (i) { return i.k === 'fever'; }));
  }
  {
    const r = rig();
    const me = r.person(0x20);
    let t = r.H.treat(me, me, 'cloth');
    yes('with nothing bleeding, torn cloth is refused', !t.ok && t.line === 'Nothing is bleeding.');
    t = r.H.treat(me, me, 'bandage');
    yes('a bandage with no wound is refused before the pack is asked', !t.ok && /no open wound a bandage/.test(t.line));
    cutOn(r, me);
    t = r.H.treat(me, me, 'bandage');
    yes('a bandage you do not carry is refused, and says who makes them',
        !t.ok && t.line === 'You carry no bandage. A Haberdasher makes them at a loom.' && wounds(r, me, 'cut')[0].bleed);
    r.give(me, 'bandage', 2);
    t = r.H.treat(me, me, 'bandage');
    const c = wounds(r, me, 'cut')[0];
    yes('a bandage stops the bleed, and one comes out of the pack',
        t.ok && !c.bleed && c.bandage && r.has(me, 'bandage') === 1 && r.H.bleedRate(r.rec(me)) === 0 &&
        t.line === 'You bandage your cut. The bleeding stops.');
    r.dice.next = [0.15];
    r.minutes(10); r.tick();
    yes('bandaged, wound fever is 10%: 0.15 does not catch', !r.rec(me).ills.length);
  }
  {
    const r = rig();
    const me = r.person(0x20);
    r.H.burning(me, true, r.clock.now);
    r.clock.now += 5000;
    r.H.burning(me, false, r.clock.now);
    r.give(me, 'bandage', 1);
    const t = r.H.treat(me, me, 'bandage');
    yes('a bandage goes on a bad burn too, for its fever', t.ok && wounds(r, me, 'burn')[0].bandage);
  }
  {
    const r = rig();
    const me = r.person(0x20);
    r.give(me, 'splint', 1);
    let t = r.H.treat(me, me, 'splint');
    yes('a splint with no break is refused and stays in the pack', !t.ok && r.has(me, 'splint') === 1);
    r.H.wound(me, 'break', 'leg', r.clock.now);
    yes('an expert healing spell will not set a break nobody splinted', r.H.healed(me, 'expert') === '' &&
        !wounds(r, me, 'break')[0].set);
    t = r.H.treat(me, me, 'splint');
    yes('a splint holds the break, and says it still has to be set', t.ok && wounds(r, me, 'break')[0].splint &&
        /still has to be set/.test(t.line) && r.has(me, 'splint') === 0);
    yes('and then an expert healing spell sets it', /sets the splinted bone/.test(r.H.healed(me, 'expert')) &&
        wounds(r, me, 'break')[0].set > 0);
  }
  {
    const r = rig();
    const me = r.person(0x20);
    cutOn(r, me);
    r.give(me, 'poultice', 1);
    let t = r.H.treat(me, me, 'poultice');
    yes('a poultice goes on an open cut', t.ok && wounds(r, me, 'cut')[0].poultice && r.has(me, 'poultice') === 0);
    r.dice.next = [0.06];
    r.minutes(10); r.tick();
    yes('with a poultice, wound fever is 5%: 0.06 does not catch', !r.rec(me).ills.some(function (i) { return i.k === 'fever'; }));
    const r2 = rig();
    const you = r2.person(0x21);
    cutOn(r2, you);
    r2.give(you, 'poultice', 1);
    r2.dice.next = [0.9];
    r2.minutes(10); r2.tick();
    t = r2.H.treat(you, you, 'poultice');
    yes('a poultice after the fever has rolled is refused, and kept', !t.ok && r2.has(you, 'poultice') === 1);
  }
  {
    const r = rig();
    const me = r.person(0x20);
    r.give(me, 'remedy', 2);
    let t = r.H.treat(me, me, 'remedy');
    yes('a remedy with no sickness and no cut is refused and kept', !t.ok && r.has(me, 'remedy') === 2);
    r.H.staff(me, ['chill'], 'staff');
    r.H.staff(me, ['fever'], 'staff');
    cutOn(r, me);
    r.minutes(11);
    t = r.H.treat(me, me, 'remedy');
    const rec = r.rec(me);
    yes('a remedy clears wound fever before anything else, and closes the cut the way a bandage does',
        t.ok && !rec.ills.some(function (i) { return i.k === 'fever'; }) && rec.ills.some(function (i) { return i.k === 'chill'; }) &&
        !rec.wounds[0].bleed && rec.wounds[0].bandage && /closes the cut and clears the wound fever/.test(t.line));
    t = r.H.treat(me, me, 'remedy');
    yes('the second clears the chill', t.ok && !r.rec(me).ills.length && r.has(me, 'remedy') === 0);
  }
  {
    // A hangover is the remedy's too (#1382, drink.md): asked of the needs
    // block, which owns it. A stand-in here; the needs half is
    // test-1382-ale-help-hangover.js.
    const r = rig();
    const me = r.person(0x20);
    const hung = {}; hung[me] = true; let sobered = 0;
    r.G.__thornswoodNeeds = {
      hungOver: function (id) { return !!hung[id]; },
      soberUp: function (id) { if (!hung[id]) { return false; } hung[id] = false; sobered++; return true; }
    };
    yes('a hangover alone is something to tend: the H line and Tend their wounds',
        r.H.careOf(me) === true && (r.H.careChanged(me), r.props[me].thornswoodHurt.care === 1));
    r.give(me, 'remedy', 2);
    let t = r.H.treat(me, me, 'remedy');
    yes('a remedy ends a hangover with nothing else to treat, and is used',
        t.ok && !hung[me] && sobered === 1 && r.has(me, 'remedy') === 1 && /clears the hangover/.test(t.line));
    t = r.H.treat(me, me, 'remedy');
    yes('with the hangover gone and nothing else, the remedy is refused and kept',
        !t.ok && r.has(me, 'remedy') === 1 && sobered === 1);
    yes('and with it gone there is nothing to tend', r.H.careOf(me) === false && (r.H.careChanged(me), r.props[me].thornswoodHurt.care === 0));
  }
  {
    const r = rig();
    const me = r.person(0x20);
    const doc = r.person(0x22, 'Danica');
    r.H.wound(me, 'break', 'arm', r.clock.now);
    let t = r.H.treat(me, me, 'set');
    yes('somebody who is not a physicker cannot set a bone', !t.ok && /Only a physicker/.test(t.line));
    r.state[doc] = { prof: 'alchemist', half: 'physicker', ranks: { physicker: 'novice', blightbrewer: 'novice' } };
    t = r.H.treat(doc, me, 'set');
    yes('a physicker sets it, with no item, and the one tended is told who did',
        t.ok && wounds(r, me, 'break')[0].set === r.clock.now &&
        r.lines(me).length === 0 && t.them === 'Danica sets your broken arm. A set break heals in 3 days.');
    r.minutes(3 * 24 * 60 + 1); r.tick();
    yes('set, it heals in 3 days and not crooked', !wounds(r, me, 'break').length && !r.rec(me).crooked.arm);
    const r2 = rig();
    const you = r2.person(0x21);
    const doc2 = r2.person(0x22, 'Danica');
    r2.H.wound(you, 'break', 'leg', r2.clock.now);
    r2.minutes(3 * 24 * 60 + 1); r2.tick();
    r2.state[doc2] = { prof: 'alchemist', half: 'physicker', ranks: { physicker: 'expert' } };
    t = r2.H.treat(doc2, you, 'set');
    yes('a crooked heal is refused short of master', !t.ok && /master physicker/.test(t.line) && r2.rec(you).crooked.leg);
    r2.state[doc2].ranks.physicker = 'master';
    t = r2.H.treat(doc2, you, 'set');
    yes('a master physicker clears it', t.ok && !r2.rec(you).crooked.leg);
  }
  {
    const r = rig();
    const me = r.person(0x20, 'Ysolda');
    const you = r.person(0x21, 'Hulda');
    cutOn(r, you);
    r.give(me, 'bandage', 1);
    r.set(you, 'pos', [1000, 0, 0]);
    let t = r.H.treat(me, you, 'bandage');
    yes('out of reach, nothing happens and the bandage stays', !t.ok && /Stand closer/.test(t.line) && r.has(me, 'bandage') === 1);
    r.set(you, 'pos', [250, 0, 0]);
    r.set(you, 'cell', 'other:Skyrim.esm');
    t = r.H.treat(me, you, 'bandage');
    yes('close but in another cell is out of reach too', !t.ok);
    r.set(you, 'cell', '3c:Skyrim.esm');
    t = r.H.treat(me, you, 'bandage');
    yes('within about 4 metres, your bandage goes on their cut, out of your pack',
        t.ok && !wounds(r, you, 'cut')[0].bleed && r.has(me, 'bandage') === 0 &&
        t.line === 'You bandage Hulda\'s cut. The bleeding stops.' && t.them === 'Ysolda bandages your cut. The bleeding stops.');
    r.set(you, 'dead', true);
    cutOn(r, you);
    t = r.H.treat(me, you, 'cloth');
    yes('nobody tends the dead', !t.ok && t.line === 'It is too late for that.');
    const npc = r.npc(0x40, 'NordRace');
    t = r.H.treat(me, npc, 'cloth');
    yes('and an NPC is nobody you can tend here', !t.ok && /nobody you can tend/.test(t.line));
  }

  // ------------------------------------------------------- the panel
  {
    const r = rig();
    const me = r.person(0x20, 'Ysolda');
    const you = r.person(0x21, 'Hulda');
    cutOn(r, me);
    r.give(me, 'bandage', 3);
    let line = r.H.panel(me, []);
    let v = r.view(me);
    yes('nothing after /treat opens your own panel: open, for you, with six rows in the page\'s order',
        line === '' && v && v.open && v.target === 'me' && v.who === '' &&
        v.rows.map(function (x) { return x.id; }).join() === 'cloth,bandage,splint,poultice,remedy,set' &&
        v.lines.indexOf('Bleeding') !== -1);
    const byId = {};
    v.rows.forEach(function (x) { byId[x.id] = x; });
    yes('each row says whether it can be done and why not, and how many you carry',
        byId.cloth.can && byId.bandage.can && byId.bandage.count === 3 && !byId.splint.can &&
        /no broken bone/.test(byId.splint.why) && byId.cloth.count === -1 && !byId.set.can);
    const at = v.at;
    line = r.H.panel(me, ['me', 'bandage']);
    v = r.view(me);
    yes('a button does it, puts the line on the panel, and draws the panel again',
        line === 'You bandage your cut. The bleeding stops.' && v.note === line && v.at > at && r.has(me, 'bandage') === 2);
    cutOn(r, you);
    line = r.H.panel(me, [you.toString(16)]);
    v = r.view(me);
    yes('their form id, as the look prompt sends it, opens their panel', v.target === you.toString(16) && v.who === 'Hulda');
    r.H.panel(me, [you.toString(16), 'cloth']);
    yes('and their button tends them, and they are told', r.H.bleedRate(r.rec(you)) === 1 &&
        r.lines(you).indexOf('Ysolda binds your bleeding with torn cloth. It slows. It has not stopped.') !== -1);
    r.set(you, 'pos', [5000, 0, 0]);
    const before = r.view(me).at;
    line = r.H.panel(me, [you.toString(16)]);
    yes('somebody walked away is not opened', /Stand closer/.test(line) && r.view(me).at === before);
    yes('a name nobody answers to is refused', /Nobody here/.test(r.H.panel(me, ['zz'])));
  }
  {
    const r = rig();
    const me = r.person(0x20);
    r.H.wound(me, 'cut', '', r.clock.now);
    r.H.treat(me, me, 'cloth');
    yes('a cut bound with cloth still wants tending', r.H.careOf(me));
    r.give(me, 'bandage', 1);
    r.H.treat(me, me, 'bandage');
    r.minutes(10); r.tick();
    yes('bandaged and past its fever roll, it leaves the list, and nothing wants tending',
        !r.rec(me).wounds.length && !r.H.careOf(me) && r.mp.get(me, 'thornswoodHurt').care === 0);
    r.H.staff(me, ['agreed', 'hand'], 'staff');
    yes('an agreed loss is not something to tend', !r.H.careOf(me));
  }

  // --------------------------------------------- the property scripts
  {
    const r = rig();
    const hud = r.made.thornswoodHurt && r.made.thornswoodHurt.updateOwner;
    const ran = [];
    const ctx = { value: { show: ['Bleeding'], care: 1 }, state: {}, sp: { browser: { executeJavaScript: function (s) { ran.push(s); } } } };
    delete globalThis.thornswoodHurtCare;
    new Function('ctx', hud)(ctx);
    const up = globalThis.thornswoodHurtCare;
    ctx.value = { show: ['Bleeding'], care: 0 };
    new Function('ctx', hud)(ctx);
    yes('the owner\'s script tells the plugin whether there is something to tend, as it changes',
        up === 1 && globalThis.thornswoodHurtCare === 0 && ran.length === 2);
    const panelScript = r.made.thornswoodTreatView && r.made.thornswoodTreatView.updateOwner;
    const sent = [];
    const pctx = { value: { open: true, at: 7 }, state: {}, sp: { browser: { executeJavaScript: function (s) { sent.push(s); } } } };
    new Function('ctx', panelScript)(pctx);
    new Function('ctx', panelScript)(pctx);
    yes('the panel\'s view reaches the page once per send, through thornswoodTreat.setData',
        sent.length === 1 && /window\.thornswoodTreat\.setData\(d\)/.test(sent[0]) &&
        r.made.thornswoodTreatView.isVisibleByOwner && !r.made.thornswoodTreatView.isVisibleByNeighbors);
  }
}

// ------------------------------------------------------------- the page
{
  const sentLines = [], told = [];
  function el(tag) {
    const e = { tag: tag, innerHTML: '', className: '', style: {}, children: [], listeners: {},
      appendChild: function (c) { this.children.push(c); return c; },
      addEventListener: function (n, f) { this.listeners[n] = f; },
      querySelector: function (q) {
        if (!this.kids) { this.kids = {}; }
        if (!this.kids[q]) { this.kids[q] = el(q); }
        return this.kids[q];
      },
      querySelectorAll: function (q) {
        if (q !== 'button[data-n]') { return []; }
        const out = [];
        const rx = /data-n="(\d+)"/g;
        let m;
        while ((m = rx.exec(this.innerHTML)) !== null) {
          const n = m[1];
          out.push({ getAttribute: function () { return n; }, disabled: false });
        }
        this.buttons = out;
        return out;
      } };
    return e;
  }
  const doc = { head: el('head'), body: el('body'), listeners: {},
    createElement: el, addEventListener: function (n, f) { this.listeners[n] = f; } };
  const win = { skyrimPlatform: { sendMessage: function (a, b) { told.push(b); } },
    thornswoodNet: { say: function (l) { sentLines.push(l); } } };
  new Function('window', 'document', page)(win, doc);
  const T = win.thornswoodTreat;
  yes('the page says it is in, and draws nothing until the server sends a view',
      !!T && told.indexOf('treat:ready') !== -1 && !T.isOpen());
  T.setData({ open: true, who: 'Hulda', target: '21', note: '', lines: ['Bleeding'],
    rows: [{ id: 'cloth', name: 'Torn cloth', can: true, why: '', count: -1 },
           { id: 'bandage', name: 'Bandage', can: false, why: 'You carry no bandage.', count: 0 }] });
  const root = doc.body.children[0];
  const body = root.querySelector('.body');
  // The buttons the page made and gave a handler to, as its draw found them.
  const buttons = body.buttons || [];
  yes('a view opens it, claims the keyboard, names whose wounds, and gives a button only where it can be done',
      T.isOpen() && told.indexOf('treat:opened') !== -1 && /Hulda\'s wounds/.test(root.querySelector('h2').innerHTML) &&
      buttons.length === 1 && /You carry no bandage\./.test(body.innerHTML));
  // The handler the page gave the button, pressed the way a click would.
  const btn = body.buttons && body.buttons[0];
  if (btn && btn.onclick) { btn.onclick.call(btn); }
  yes('the button sends /treat with whose and what, the one line the server answers, and waits',
      sentLines.length === 1 && sentLines[0] === '/treat 21 cloth' && btn.disabled === true);
  T.setData({ open: true, who: '', target: 'me', lines: [], rows: [{ id: 'cloth', name: 'Torn cloth', can: true, why: '', count: -1 }] });
  body.buttons[0].onclick.call(body.buttons[0]);
  yes('and on your own panel it says me', sentLines[1] === '/treat me cloth' &&
      /Your wounds/.test(root.querySelector('h2').innerHTML));
  T.close();
  yes('closing gives the keyboard back', told.indexOf('treat:closed') !== -1 && !T.isOpen());
}

// ------------------------------------------------------------- the client
yes('the panel is loaded and the two minute cap can close it, and it claims the keyboard while up',
    /'thornswood-treat\.js'/.test(front) && /treat: 'thornswoodTreat'/.test(front) &&
    /'treat:opened'\) \{ T\.claimFocus\('treat', true\)/.test(front) &&
    /'treat:closed'\) \{ T\.claimFocus\('treat', false\)/.test(front));
yes('Tend their wounds is the lock key, X, and Tend your wounds the trade key, H, and neither is a new key',
    /(?:const|let) TREAT_KEY = LOCK_KEY;/.test(front) && /(?:const|let) TREAT_SELF_KEY = TRADE_KEY;/.test(front) &&
    !/iniNumber\(ini, 'Treat/.test(front));
yes('the look prompt draws the row only for somebody the near list marks t, and the key sends /treat with their id',
    /\(row\.t \? keyRow\(TREAT_NAME, 'Tend their wounds', false\) : ''\)/.test(front) &&
    /'\|' \+ \(row\.t \|\| 0\)\) : ''/.test(front) &&
    /function treatPress\(\) \{[\s\S]*?if \(!row \|\| !row\.t\) \{ return false; \}\s*return lookVerb\('treat'\);/.test(front));
yes('the inventory line is up only while there is something to tend, and its key shuts the inventory and asks for /treat',
    /drawTreatSelfLine\(!!T\.ready && hurtCare\(\)\)/.test(front) &&
    /function treatSelfPress\(\) \{[\s\S]*?isMenuOpen\(INVENTORY_MENU\)[\s\S]*?if \(!hurtCare\(\)\)[\s\S]*?closeMenu\(INVENTORY_MENU\)[\s\S]*?tellServer\('\/treat'\)/.test(front));
{
  const keys = front.indexOf('if (e.code === LOCK_KEY && lockPress()) { return; }');
  const treat = front.indexOf('if (e.code === TREAT_KEY && treatPress()) { return; }');
  const self = front.indexOf('if (e.code === TREAT_SELF_KEY && treatSelfPress()) { return; }');
  const social = front.indexOf('if (e.code === FRIEND_KEY || e.code === TRADE_KEY || e.code === MUTE_KEY ||');
  yes('the lock key asks its door first; both treat keys are asked before the social keys refuse a key over the inventory',
      keys > 0 && treat > keys && self > treat && social > self);
}
yes('the server tells the look prompt t for somebody with a wound to tend',
    /if \(them\.care\) \{ w\[them\.id\.toString\(16\)\]\.t = 1; \}/.test(src) &&
    /care = !!\(g\.__thornswoodHurt && g\.__thornswoodHurt\.careOf && g\.__thornswoodHurt\.careOf\(id\)\)/.test(src));
{
  const wordsLine = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(src);
  const playerLine = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(src);
  let WORDS = [], PLAYER = [];
  try { WORDS = new Function('return ' + wordsLine[1])(); PLAYER = new Function('return ' + playerLine[1])(); } catch (e) { }
  yes('/treat is a line the server answers for the keys and the panel, and nobody is told about it',
      WORDS.indexOf('/treat') !== -1 && PLAYER.indexOf('/treat') === -1 &&
      /if \(word === '\/treat'\) \{[\s\S]*?tending\.panel\(actorId, parts\.slice\(1\)\)/.test(src));
  const lits = (src.match(/'(?:[^'\\\n]|\\.)*'/g) || []).filter(function (l) { return l.indexOf('/treat') !== -1; });
  yes('no line a person reads tells them to type /treat', lits.length === 2 &&
      lits.every(function (l) { return l === "'/treat'"; }));
}
{
  // The rows on Settings in the game (#3126), where the launcher's Controls
  // page rows were.
  const settingsPage = read('game', 'ui', 'thornswood-settings.js');
  const ini = read('launcher', 'Thornswood.ini');
  yes('Settings in the game and the shipped ini say what X and H do for wounds',
      /\{ ini: 'LockKey', def: 45,[^}]*Looking at somebody with a wound to tend, opens the panel that tends it\.' \}/.test(settingsPage) &&
      /\{ ini: 'TradeWithKey', def: 35,[^}]*In your inventory, while you have a wound to tend, the same key opens the panel that tends it\.' \}/.test(settingsPage) &&
      /wound to tend[\s\S]{0,120}\nTradeWithKey = 35/.test(ini) && /wound to tend[\s\S]{0,140}\nLockKey = 45/.test(ini));
}
yes('the injury page no longer lists the treatments or the blows as not in',
    !/None of them is an item yet/.test(injury) && !/This page does not\s+say which blow does it/.test(injury) &&
    /Tend their wounds, on\s+X/.test(injury));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
