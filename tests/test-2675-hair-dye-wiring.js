// test-2675-hair-dye-wiring.js
//
//     node tests/test-2675-hair-dye-wiring.js
//
// #2675, the second slice of hair dye: the steep, the K panel, the offer and
// the one write, as the gamemode runs them.
//
// G: THE CARRIED LIST. The gamemode carries game/data/hair-dyes.json and
//    game/hair-dye.js between its HAIR_DYES markers, and what it carries is
//    those two exactly (Build-HairDyeGamemode.js --check), the WAR_STAGES way.
// S: THE STEEP. E at the list's cooking spot with one dye's inputs starts a
//    steep, one at a time; walking off before steepSeconds loses it and takes
//    nothing; after it the inputs go and one named entry comes.
// T: A TAILOR'S JOB (Patrick, 18 Oct). Only the list's halves may steep, asked
//    the way a bench asks; anybody else is told whose work it is, nothing is
//    taken, and their boil still runs. Using a dye stays anybody's.
// W: THE WATER LEDGER. The bottle a dye takes is spent from n.water by the
//    rule a drink uses, worst first. With a dye and a boil on one press the
//    dye takes its bottle first and the boil turns what is left; a boil left
//    with nothing to turn says nothing; a drink settles the fire the same way.
// O: THE OFFER. Somebody else's hair is an offer of kind 'dye'. Nothing is
//    taken or written on the offer; on Accept it is all checked again (the
//    dye carried, both within reach, the same character) and only then the
//    dye is used and the hair written. Refuse changes nothing.
// A: THE ONE WRITE. The stored appearance is read, only hairColor changes,
//    bodyShapeGuard has the last word, the made colour is kept from the first
//    dye on, and one log line names who, whose hair, which dye, and the old
//    and new colour. No client-sent appearance is ever written.
// M: A DYE IS NOT A PLAIN BOWL. addItem, takeItem, takeItemById and
//    addItemsAtomic leave a minted entry alone; a merchant neither counts nor
//    takes one; the take limit counts a named stack apart.
// R: THE WORDS AND THE ROUTER. /hairdye is in WORDS and not PLAYER_WORDS, and
//    /yes has the 'dye' branch.
// U: THE PANELS. K's Hair dye page, P's Dye hair, the look prompt's row and
//    key, and the front's redraw of the hair.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8').split(CR).join('');
const gm = read('game/gamemode.js');
const DATA = JSON.parse(read('game/data/hair-dyes.json'));
const MOD = require(path.join(REPO, 'game', 'hair-dye.js'));

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '  (' + why + ')' : '')); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function lift(from, to, src) {
  src = src || gm;
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(to, a + from.length);
  return b < 0 ? null : src.slice(a, b + to.length);
}

// ------------------------------------------------------------- G: carried
const built = cp.spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dev', 'Build-HairDyeGamemode.js'), '--check'],
  { cwd: REPO, encoding: 'utf8' });
yes('G1 Build-HairDyeGamemode.js --check passes', built.status === 0, (built.stdout + built.stderr).trim());
const region = lift('  // ==== HAIR_DYES ====', '  // ==== end HAIR_DYES ====');
yes('G2 the gamemode has the HAIR_DYES region once', !!region && gm.split('  // ==== HAIR_DYES ====').length === 2);
const carriedBox = {};
try { vm.runInNewContext(region + '\nthis.D = HAIR_DYES; this.M = HAIR_DYE;', carriedBox); } catch (e) { carriedBox.err = e; }
yes('G3 the carried list is the data file', JSON.stringify(carriedBox.D) === JSON.stringify(DATA));
yes('G4 the carried module is game/hair-dye.js', !!carriedBox.M &&
    JSON.stringify(Object.keys(carriedBox.M).sort()) === JSON.stringify(Object.keys(MOD).sort()) &&
    region.indexOf(read('game/hair-dye.js').trim().split('\n').slice(-3).join('\n')) >= 0);
yes('G5 the carried list passes its own check', !!carriedBox.M && carriedBox.M.checkDyes(carriedBox.D).length === 0);
const BUILD = require(path.join(REPO, 'scripts', 'dev', 'Build-HairDyeGamemode.js'));
yes('G6 the builder writes what is there', typeof BUILD.region === 'function' && gm.indexOf(BUILD.region(read('game/data/hair-dyes.json'), read('game/hair-dye.js'))) >= 0);

// --------------------------------------------------------- the stand-ins
const blockSrc = lift('// ==== thornswood hair dye ====', '// ==== end thornswood hair dye ====');
const needsFns = ['  function nearFire(n) {', '  function unboiledHeld(n) {', '  function boilCheck(actorId, n) {',
  '  function fireSettle(actorId, n) {', '  function boilSay(actorId, n) {', '  function spendBottle(n) {',
  '  function spendWater(actorId, count) {'].map((h) => lift(h, '\n  }\n'))
  .concat([(() => { const one = '  function fireNear(actorId) { return nearFire(read(actorId)); }\n'; return gm.indexOf(one) >= 0 ? one : null; })()]);
const topFns = ['function mintedBy(owner, test) {', 'function mintedEntry(entry) {', 'function addItem(actorId, itemDesc, count) {',
  'function takeItem(', 'function takeItemById(', 'function bodyShapeGuard(appearance) {'].map((h) => lift(h, '\n}\n'));
const atomic = lift('function addItemsAtomic(', '\n}\n');
const bodyConsts = lift('const BODY_APPEARANCE_FIELDS', "'name'];") + '\nconst BODY_WEIGHT_MIN = 0;\nconst BODY_WEIGHT_MAX = 100;\nconst BODY_WEIGHT_DEFAULT = 50;\n';
const order = /waterOrder: (\[[^\]]*\])/.exec(gm), unboiled = /unboiled: (\[[^\]]*\])/.exec(gm);
const boilSecs = /boilSeconds: (\d+)/.exec(gm), fireReach = /fire: \{ at: \d+, master: \d+, reach: (\d+) \}/.exec(gm);
yes('S0 the hair dye block and the needs and item helpers are found',
    !!blockSrc && needsFns.every(Boolean) && topFns.every(Boolean) && !!atomic && !!order && !!unboiled && !!boilSecs && !!fireReach);
if (fail) done();

const IDS = {};
let nextId = 0x5000;
function idFor(desc) { if (!IDS[desc]) { IDS[desc] = nextId++; } return IDS[desc]; }
const WATER = '13f598:WindhelmSSE.esp';
const COOK = DATA.steepAt;

function world() {
  const props = {};
  const W = { clock: 1000000, logs: [], said: [], sets: [], props: props, needs: {} };
  const mp = {
    get: (id, k) => { const v = (props[id] || {})[k]; return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); },
    set: (id, k, v) => { W.sets.push([id, k]); (props[id] = props[id] || {})[k] = JSON.parse(JSON.stringify(v)); },
    makeProperty: () => {}
  };
  const g = {};
  const ctx = {
    mp: mp, console: { log: (s) => W.logs.push(String(s)) },
    Date: { now: () => W.clock }, Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    JSON: JSON, Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite,
    idOf: (d) => idFor(d),
    log: function () { W.logs.push('[thornswood] ' + Array.prototype.slice.call(arguments).join(' ')); },
    say: (id, line) => W.said.push([id, line]), notify: () => {},
    auditPerson: (id) => 'P' + Number(id).toString(16),
    NEEDS: { waterOrder: JSON.parse(order[1].replace(/'/g, '"')), unboiled: JSON.parse(unboiled[1].replace(/'/g, '"')),
             boilSeconds: Number(boilSecs[1]), fire: { reach: Number(fireReach[1]) }, waterItems: { full: WATER } },
    settle: (id) => { W.needs[id] = W.needs[id] || { water: {}, fire: -1 }; return JSON.parse(JSON.stringify(W.needs[id])); },
    read: (id) => JSON.parse(JSON.stringify(W.needs[id] || { water: {}, fire: -1 })),
    write: (id, n) => { W.needs[id] = JSON.parse(JSON.stringify(n)); },
    W: W
  };
  ctx.globalThis = g; g.mp = mp;
  vm.createContext(ctx);
  ctx.g = g;
  vm.runInContext('var globalThis = g;\n' + bodyConsts + topFns.join('\n') + atomic + needsFns.join('\n') +
    '\ng.__thornswoodNeeds = { spendWater: spendWater, fireNear: fireNear, waterItem: function () { return NEEDS.waterItems.full; } };\n' +
    'this.boilSay = boilSay; this.fireSettle = fireSettle; this.addItem = addItem; this.takeItem = takeItem;' +
    'this.takeItemById = takeItemById; this.mintedEntry = mintedEntry; this.addItemsAtomic = addItemsAtomic;\n', ctx);
  // The character and social stand-ins.
  // Who works what (#2675, Patrick 18 Oct: making dye is a tailor's job). Everybody
  // here is a novice Haberdasher unless a test says otherwise; canWork is the
  // progression block's question, on the same ladder.
  W.ranks = {};
  const LADDER = ['novice', 'advanced', 'expert', 'master'];
  g.__thornswoodCharacter = {
    stateOf: (id) => ({ ranks: Object.prototype.hasOwnProperty.call(W.ranks, id) ? W.ranks[id] : { haberdasher: 'novice' } }),
    nameOf: (h) => h.charAt(0).toUpperCase() + h.slice(1), writeState: () => {}
  };
  g.__thornswoodProgression = {
    canWork: (s, half, rank) => !!(s && s.ranks && s.ranks[half]) && LADDER.indexOf(s.ranks[half]) >= LADDER.indexOf(rank || 'novice')
  };
  const offers = {};
  g.__thornswoodSocial = {
    SOCIAL: { offerFor: 45000 }, offers: offers,
    profileOf: (a) => (W.profiles || {})[a] || 0,
    nameOfPerson: (a) => (W.names || {})[a] || 'Somebody',
    findPerson: (w) => { const id = parseInt(w, 16); return (W.names || {})[id] ? { actorId: id, why: '' } : { actorId: 0, why: 'Nobody here by that name.' }; },
    offer: (kind, from, to, about) => {
      const f = W.profiles[from], t = W.profiles[to];
      if (!f || !t) return 'That person is not here.';
      offers[t] = { kind: kind, from: f, fromName: W.names[from], at: W.clock, about: String(about || '') };
      return '';
    },
    push: () => {}
  };
  vm.runInContext(blockSrc, ctx);
  W.ctx = ctx; W.g = g; W.HD = g.__thornswoodHairDye; W.mp = mp;
  return W;
}
const A = 0xff000101, B = 0xff000202;
function people(W) {
  W.profiles = {}; W.profiles[A] = 11; W.profiles[B] = 22;
  W.names = {}; W.names[A] = 'Ada'; W.names[B] = 'Bram';
  [A, B].forEach((id, i) => {
    W.mp.set(id, 'worldOrCellDesc', '3c:Skyrim.esm');
    W.mp.set(id, 'pos', [i * 100, 0, 0]);
    W.mp.set(id, 'appearance', { isFemale: false, raceId: 1, weight: 50, skinColor: 0, hairColor: 0x102030 + i,
                                 headpartIds: [1, 2], headTextureSetId: 0, options: [], presets: [], tints: [], name: W.names[id] });
  });
  W.sets.length = 0;
}
const dyeById = (id) => DATA.dyes.find((d) => d.id === id);
const brown = dyeById('brown');
function packWith(dye, extra) {
  const e = dye.inputs.map((p) => ({ baseId: idFor(p.item), count: p.count }));
  (extra || []).forEach((x) => {
    const at = e.find((r) => r.baseId === x.baseId && !r.name);
    if (at && !x.name) { at.count += x.count; } else { e.push(x); }
  });
  return e;
}
const count = (entries, baseId, name) => entries.filter((e) => e.baseId === baseId && (name === undefined ? !e.name : e.name === name))
  .reduce((s, e) => s + e.count, 0);
const BOWL = idFor(DATA.item);

// ---------------------------------------------------------------- S: steep
{
  const W = world(); people(W);
  yes('S1 the block is ready with the shipped list', !!W.HD && !!W.HD.list() && W.logs.some((l) => /ready: \d+ dyes/.test(l)));
  W.mp.set(A, 'inventory', { entries: [{ baseId: idFor(WATER), count: 1 }] });
  yes('S2 a press with no dye\'s inputs is none of the dye\'s business', W.HD.pressed(A, COOK) === '');
  W.mp.set(A, 'inventory', { entries: packWith(brown) });
  yes('S3 a press at another bench is none of its business', W.HD.pressed(A, 'other:Skyrim.esm') === '');
  W.needs[A] = { water: { river: 1 }, fire: 10 };
  const line = W.HD.pressed(A, COOK);
  yes('S4 a press at the cooking spot with the inputs starts a steep', /You set Brown Hair Dye to steep/.test(line), line);
  yes('S5 one steep at a time', W.HD.pressed(A, COOK) === '');
  W.clock += 30000;
  W.ctx.boilSay(A, W.ctx.read(A));
  yes('S6 before steepSeconds nothing is taken', count(W.mp.get(A, 'inventory').entries, BOWL, 'Brown Hair Dye') === 0 &&
      count(W.mp.get(A, 'inventory').entries, idFor(WATER)) === 1);
  W.needs[A].fire = -1;
  W.said.length = 0;
  W.ctx.boilSay(A, W.ctx.read(A));
  yes('S7 leaving the fire early loses the steep', W.said.some((s) => /You left the fire, and Brown Hair Dye did not steep/.test(s[1])));
  const inv = W.mp.get(A, 'inventory').entries;
  yes('S8 ...and takes nothing', JSON.stringify(inv) === JSON.stringify(packWith(brown)) && W.needs[A].water.river === 1);
  W.needs[A].fire = 10;
  W.HD.pressed(A, COOK);
  W.clock += DATA.steepSeconds * 1000;
  W.said.length = 0;
  W.ctx.boilSay(A, W.ctx.read(A));
  const after = W.mp.get(A, 'inventory').entries;
  yes('S9 after steepSeconds by the fire the dye is in the pack', count(after, BOWL, 'Brown Hair Dye') === 1 &&
      W.said.some((s) => /Brown Hair Dye has steeped/.test(s[1])), JSON.stringify(after));
  yes('S10 ...and every input is gone', brown.inputs.every((p) => count(after, idFor(p.item)) === 0));
  W.mp.set(A, 'inventory', { entries: packWith(brown, packWith(brown)) });
  W.HD.pressed(A, COOK); W.clock += DATA.steepSeconds * 1000; W.ctx.boilSay(A, W.ctx.read(A));
  W.HD.pressed(A, COOK); W.clock += DATA.steepSeconds * 1000; W.ctx.boilSay(A, W.ctx.read(A));
  const two = W.mp.get(A, 'inventory').entries;
  yes('S11 a second dye of the same kind stacks on the one entry', two.filter((e) => e.name === 'Brown Hair Dye').length === 1 &&
      count(two, BOWL, 'Brown Hair Dye') === 2);
  const v = W.HD.view(A);
  yes('S12 K\'s view lists the dye carried', !!v && v.dyes.length === 1 && v.dyes[0].id === 'brown' && v.dyes[0].count === 2 && v.steeping === null);
  W.HD.pressed(A, COOK);
  yes('S13 nothing to steep and nothing carried: no view', world().HD.view(A) === null);
}

// ------------------------------------------------- T: a tailor's job (18 Oct)
{
  const NOT = 'Steeping hair dye is work for a Haberdasher or Liverywright. Nothing was taken from your pack.';
  const W = world(); people(W);
  W.ranks[A] = { hearthcook: 'master' };
  W.mp.set(A, 'inventory', { entries: packWith(brown) });
  W.needs[A] = { water: { river: 1 }, fire: 10, boilFrom: W.clock, boilFire: true };
  const line = W.HD.pressed(A, COOK);
  yes('T1 somebody who is not a tailor pressing E with a dye\'s inputs is told whose work it is', line === NOT, line);
  yes('T2 ...no steep starts and nothing is taken', !Object.prototype.hasOwnProperty.call(W.HD.steeps, A) &&
      JSON.stringify(W.mp.get(A, 'inventory').entries) === JSON.stringify(packWith(brown)));
  W.clock += 61000; W.said.length = 0;
  W.ctx.boilSay(A, W.ctx.read(A));
  yes('T3 ...and the boil on the same press still runs', W.said.length === 1 && /The water has boiled/.test(W.said[0][1]) &&
      W.needs[A].water.boiled === 1 && !W.needs[A].water.river, JSON.stringify(W.said));
  yes('T4 the onActivate hook runs the boil whatever the dye answered',
      /if \(dLine\) \{ notify\(casterRefrId, dLine\); say\(casterRefrId, dLine\); answeredHere = true; \}\n\s*var wLine = needsW\.activatedWater\(/.test(gm));
  W.ranks[A] = { liverywright: 'novice' };
  yes('T5 a Liverywright may steep', /You set Brown Hair Dye to steep/.test(W.HD.pressed(A, COOK)));
  delete W.HD.steeps[A];
  W.ranks[A] = { haberdasher: 'expert' };
  yes('T6 so may an expert Haberdasher: every rung of the ladder counts', /to steep/.test(W.HD.pressed(A, COOK)));
  W.ranks[A] = {};
  W.clock += DATA.steepSeconds * 1000;
  W.said.length = 0;
  W.ctx.boilSay(A, W.ctx.read(A));
  yes('T7 a steep whose maker is no longer a tailor when it is done takes nothing', W.said.some((s) => s[1] === NOT) &&
      JSON.stringify(W.mp.get(A, 'inventory').entries) === JSON.stringify(packWith(brown)));
  W.mp.set(A, 'inventory', { entries: [{ baseId: BOWL, count: 1, name: 'Brown Hair Dye' }] });
  yes('T8 using a dye is still anybody\'s', W.HD.command(['/hairdye', 'self', 'brown'], A) === 'You dye your hair with Brown Hair Dye.');
  const W2 = world(); people(W2);
  delete W2.g.__thornswoodProgression;
  W2.mp.set(A, 'inventory', { entries: packWith(brown) });
  yes('T9 without the progression block nobody may steep: the list is closed, not open', W2.HD.pressed(A, COOK) === NOT);
  yes('T10 the line names no half in code: it is built from the list', !/haberdasher|liverywright|tailor'/i.test(
      blockSrc.replace(lift('  // ==== HAIR_DYES ====', '  // ==== end HAIR_DYES ====', blockSrc), '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
}

// -------------------------------------------------------- W: water ledger
{
  const W = world(); people(W);
  // Three bottles: two from the river, one from a well. A boil and a dye on one press.
  W.mp.set(A, 'inventory', { entries: packWith(brown, [{ baseId: idFor(WATER), count: 2 }]) });
  W.needs[A] = { water: { river: 2, well: 1 }, fire: 10, boilFrom: W.clock, boilFire: true };
  W.HD.pressed(A, COOK);
  W.clock += Math.max(DATA.steepSeconds, Number(boilSecs[1])) * 1000;
  W.said.length = 0;
  W.ctx.boilSay(A, W.ctx.read(A));
  const w = W.needs[A].water;
  yes('W1 the dye takes its bottle first, the worst one carried', !w.river && w.well === 1 && w.boiled === 1, JSON.stringify(w));
  yes('W2 the ledger counts the bottles still carried', (w.well || 0) + (w.boiled || 0) === count(W.mp.get(A, 'inventory').entries, idFor(WATER)));
  yes('W3 both are said, the dye first', W.said.length === 2 && /steeped/.test(W.said[0][1]) && /The water has boiled/.test(W.said[1][1]),
      JSON.stringify(W.said));
  // The dye takes the last unboiled bottle: the boil has nothing to do.
  const W2 = world(); people(W2);
  W2.mp.set(A, 'inventory', { entries: packWith(brown) });
  W2.needs[A] = { water: { sea: 1 }, fire: 10, boilFrom: W2.clock, boilFire: true };
  W2.HD.pressed(A, COOK);
  W2.clock += 61000; W2.said.length = 0;
  W2.ctx.boilSay(A, W2.ctx.read(A));
  yes('W4 a boil left with nothing to boil says nothing', W2.said.length === 1 && /steeped/.test(W2.said[0][1]) &&
      Object.keys(W2.needs[A].water).length === 0 && W2.needs[A].boilFrom === null, JSON.stringify(W2.said) + JSON.stringify(W2.needs[A]));
  // A bottle the ledger never counted (an inn's) costs the ledger nothing.
  const W3 = world(); people(W3);
  W3.mp.set(A, 'inventory', { entries: packWith(brown) });
  W3.needs[A] = { water: {}, fire: 10 };
  W3.HD.pressed(A, COOK); W3.clock += 61000; W3.ctx.boilSay(A, W3.ctx.read(A));
  yes('W5 a bottle the ledger never counted leaves it as it was', Object.keys(W3.needs[A].water).length === 0 &&
      count(W3.mp.get(A, 'inventory').entries, BOWL, 'Brown Hair Dye') === 1);
  // A drink before the next place report settles the fire the same way.
  const W4 = world(); people(W4);
  W4.mp.set(A, 'inventory', { entries: packWith(brown, [{ baseId: idFor(WATER), count: 1 }]) });
  W4.needs[A] = { water: { river: 2 }, fire: 10, boilFrom: W4.clock, boilFire: true };
  W4.HD.pressed(A, COOK); W4.clock += 61000;
  const fsd = W4.ctx.fireSettle(A, W4.ctx.settle(A));
  yes('W6 fireSettle takes the dye\'s bottle before the boil', fsd.lines.length === 2 && fsd.n.water.boiled === 1 && !fsd.n.water.river,
      JSON.stringify(fsd));
  const drank = lift('  function drankWater(actorId) {', '\n  }\n');
  yes('W7 a drink settles the fire through fireSettle and spends through spendBottle',
      !!drank && /fireSettle\(actorId, settle\(actorId\)\)/.test(drank) && /spendBottle\(n\)/.test(drank) &&
      !/boilCheck\(/.test(drank) && !/n\.water\[src\]--/.test(drank));
  yes('W8 nothing but spendBottle takes a bottle off the ledger',
      (gm.match(/n\.water\[[a-zA-Z]+\]--/g) || []).length === 1 && /function spendBottle[\s\S]{0,400}n\.water\[src\]--/.test(gm));
  yes('W9 the needs block hands spendWater, fireNear and waterItem out', /spendWater: spendWater, fireNear: fireNear,/.test(gm) &&
      /waterItem: function \(\) \{ return NEEDS\.waterItems\.full; \}/.test(gm));
  yes('W10 onActivate asks the dye before the water', /dyeW\.pressed\(casterRefrId, kwW\)[\s\S]{0,300}needsW\.activatedWater\(casterRefrId/.test(gm));
}

// ------------------------------------------------------- A: the one write
{
  const W = world(); people(W);
  W.mp.set(A, 'inventory', { entries: [{ baseId: BOWL, count: 1, name: 'Brown Hair Dye' }, { baseId: BOWL, count: 4 }] });
  const before = W.mp.get(A, 'appearance');
  W.mp.set(A, 'appearance', Object.assign(W.mp.get(A, 'appearance'), { sneaky: 1 }));
  W.sets.length = 0; W.logs.length = 0;
  const said = W.HD.command(['/hairdye', 'self', 'brown'], A);
  const ap = W.mp.get(A, 'appearance');
  yes('A1 Dye my hair dyes your own hair', said === 'You dye your hair with Brown Hair Dye.' && ap.hairColor !== 0x102030, said);
  const expect = MOD.mixColour(0x102030, brown, 0x102030, () => 0.5);
  yes('A2 the colour is the module\'s sum on the stored colour', ap.hairColor === expect, ap.hairColor + ' vs ' + expect);
  yes('A3 only the hair colour changed, through bodyShapeGuard (which dropped what is not a body field)',
      JSON.stringify(Object.assign({}, ap, { hairColor: 0 })) === JSON.stringify(Object.assign({}, before, { hairColor: 0 })));
  yes('A4 the dye is used and the plain bowls are not', count(W.mp.get(A, 'inventory').entries, BOWL, 'Brown Hair Dye') === 0 &&
      count(W.mp.get(A, 'inventory').entries, BOWL) === 4);
  const lines = W.logs.filter((l) => /hair dye:/.test(l));
  const hx = '#' + ('000000' + expect.toString(16)).slice(-6);
  yes('A5 one log line: who, whose hair, which dye, before and after', lines.length === 1 &&
      lines[0].indexOf('[thornswood] hair dye: Pff000101 dyed their own hair with Brown Hair Dye, from #102030 to ' + hx) === 0, lines.join(' | '));
  yes('A6 the made colour is kept from the first dye', JSON.stringify(W.mp.get(A, 'thornswoodHairMade')) === JSON.stringify({ c: 0x102030, at: W.clock }));
  W.mp.set(A, 'inventory', { entries: [{ baseId: BOWL, count: 1, name: 'Hair Wash' }] });
  W.clock += 5;
  W.HD.command(['/hairdye', 'self', 'hair-wash'], A);
  yes('A7 a second dye keeps the first made colour, and a wash goes back towards it',
      W.mp.get(A, 'thornswoodHairMade').c === 0x102030 &&
      W.mp.get(A, 'appearance').hairColor === MOD.mixColour(expect, dyeById('hair-wash'), 0x102030, () => 0.5));
  yes('A8 a dye not carried is refused and nothing is written', (() => {
    W.sets.length = 0;
    const r = W.HD.command(['/hairdye', 'self', 'black'], A);
    return /not carrying Black Hair Dye/.test(r) && W.sets.length === 0;
  })());
  yes('A9 a dye that is not on the list is refused', W.HD.command(['/hairdye', 'self', 'mauve'], A) === 'There is no such dye.');
  yes('A10 the block writes the stored appearance and nothing a client sent',
      (blockSrc.match(/mp\.set\(/g) || []).length === 3 && /mp\.set\(target, 'appearance', guarded\.appearance\)/.test(blockSrc) &&
      /stored = mp\.get\(target, 'appearance'\)/.test(blockSrc) && !/parts\[[0-9]\][^\n]*appearance/.test(blockSrc));
  const sets = W.sets.map((s) => s[1]);
  yes('A11 a refused write leaves the pack as it was', (() => {
    const W2 = world(); people(W2);
    W2.mp.set(A, 'inventory', { entries: [{ baseId: BOWL, count: 1, name: 'Brown Hair Dye' }] });
    const real = W2.mp.set;
    W2.mp.set = (id, k, v) => { if (k === 'appearance') throw new Error('no'); return real(id, k, v); };
    const r = W2.HD.command(['/hairdye', 'self', 'brown'], A);
    return /would not take/.test(r) && count(W2.mp.get(A, 'inventory').entries, BOWL, 'Brown Hair Dye') === 1;
  })());
  void sets;
}

// --------------------------------------------------------------- O: offer
{
  const W = world(); people(W);
  W.mp.set(A, 'inventory', { entries: [{ baseId: BOWL, count: 1, name: 'Brown Hair Dye' }] });
  W.sets.length = 0;
  const r = W.HD.command(['/hairdye', 'offer', B.toString(16), 'brown'], A);
  const o = W.g.__thornswoodSocial.offers[22];
  yes('O1 an offer of kind dye stands for them', /Asked Bram/.test(r) && !!o && o.kind === 'dye' && o.about === 'Brown Hair Dye' &&
      o.dye === 'brown' && o.dyer === A, r);
  yes('O2 the offer takes nothing and writes nothing', W.sets.length === 0 && count(W.mp.get(A, 'inventory').entries, BOWL, 'Brown Hair Dye') === 1 &&
      W.mp.get(B, 'appearance').hairColor === 0x102031);
  yes('O3 they are told on their prompt', W.said.some((s) => s[0] === B && /Ada offers to dye your hair with Brown Hair Dye/.test(s[1])));
  // Refuse is the generic /no: it deletes the offer and nothing else.
  delete W.g.__thornswoodSocial.offers[22];
  yes('O4 Refuse changes nothing', W.mp.get(B, 'appearance').hairColor === 0x102031 && count(W.mp.get(A, 'inventory').entries, BOWL, 'Brown Hair Dye') === 1);
  // Accept, too far: nothing.
  W.mp.set(B, 'pos', [DATA.reach + 200, 0, 0]);
  let got = W.HD.accept(B, A, o);
  yes('O5 Accept from out of reach is refused and nothing written', /closer/.test(got.them) && W.mp.get(B, 'appearance').hairColor === 0x102031);
  W.mp.set(B, 'pos', [100, 0, 0]);
  got = W.HD.accept(B, 0xff000999, o);
  yes('O6 Accept when the offer came from another character is refused', /another of their characters/.test(got.them) &&
      W.mp.get(B, 'appearance').hairColor === 0x102031);
  W.logs.length = 0;
  got = W.HD.accept(B, A, o);
  yes('O7 Accept dyes their hair and uses the dyer\'s dye', /Ada dyes your hair with Brown Hair Dye/.test(got.them) &&
      /You dye Bram's hair/.test(got.dyer) && W.mp.get(B, 'appearance').hairColor === MOD.mixColour(0x102031, brown, 0x102031, () => 0.5) &&
      count(W.mp.get(A, 'inventory').entries, BOWL, 'Brown Hair Dye') === 0);
  yes('O8 the log line names the dyer and whose hair', W.logs.some((l) => /hair dye: Pff000101 dyed the hair of Pff000202 with Brown Hair Dye, from #102031 to #/.test(l)));
  got = W.HD.accept(B, A, o);
  yes('O9 a second Accept on a used dye writes nothing', /hair is as it was/.test(got.them));
  W.mp.set(A, 'inventory', { entries: [{ baseId: BOWL, count: 1, name: 'Brown Hair Dye' }] });
  yes('O10 you cannot offer yourself', /That is you/.test(W.HD.command(['/hairdye', 'offer', A.toString(16), 'brown'], A)));
  W.mp.set(A, 'inventory', { entries: [{ baseId: BOWL, count: 1, name: 'Brown Hair Dye' }] });
  W.mp.set(B, 'pos', [DATA.reach + 200, 0, 0]);
  yes('O11 an offer from out of reach is not made', /Stand closer to Bram/.test(W.HD.command(['/hairdye', 'offer', B.toString(16), 'brown'], A)) &&
      !W.g.__thornswoodSocial.offers[22]);
  yes('O12 the near list asks carries() once, only with somebody near', /dyeing < 0[\s\S]{0,200}dyes\.carries\(me\.id\)/.test(gm) &&
      /w\[them\.id\.toString\(16\)\]\.hd = 1/.test(gm));
  yes('O13 the social view carries dyes and K carries hairDye', /dyes: \(function \(\) \{[\s\S]{0,200}HDv\.carried\(actorId\)/.test(gm) &&
      /view\.hairDye = dyePage/.test(gm));
}

// --------------------------------------------- M: a dye is not a plain bowl
{
  const W = world(); people(W);
  W.mp.set(A, 'inventory', { entries: [{ baseId: BOWL, count: 2, name: 'Brown Hair Dye' }, { baseId: BOWL, count: 1 }] });
  W.ctx.addItem(A, DATA.item, 3);
  let e = W.mp.get(A, 'inventory').entries;
  yes('M1 addItem stacks plain bowls on the plain entry, not the dye', count(e, BOWL, 'Brown Hair Dye') === 2 && count(e, BOWL) === 4);
  W.mp.set(A, 'inventory', { entries: [{ baseId: BOWL, count: 2, name: 'Brown Hair Dye' }] });
  W.ctx.addItem(A, DATA.item, 1);
  e = W.mp.get(A, 'inventory').entries;
  yes('M2 ...and with no plain entry makes one', e.length === 2 && count(e, BOWL) === 1 && count(e, BOWL, 'Brown Hair Dye') === 2);
  yes('M3 takeItem never takes a dye for a bowl', W.ctx.takeItem(A, DATA.item, 2) === false && count(W.mp.get(A, 'inventory').entries, BOWL, 'Brown Hair Dye') === 2);
  yes('M4 takeItemById neither', W.ctx.takeItemById(A, BOWL, 2) === false && W.ctx.takeItemById(A, BOWL, 1) === true &&
      count(W.mp.get(A, 'inventory').entries, BOWL, 'Brown Hair Dye') === 2);
  yes('M5 addItemsAtomic leaves the dye alone', /entry\.baseId===good\.baseId && !mintedEntry\(entry\)/.test(atomic));
  yes('M6 a named entry nobody registered is still the plain item (condition in a name, #1719)',
      W.ctx.mintedEntry({ baseId: BOWL, count: 1, name: 'Bowl (worn)' }) === false && W.ctx.mintedEntry({ baseId: BOWL, count: 1, name: 'Brown Hair Dye' }) === true);
  yes('M7 the registry is keyed, so a reload replaces the hair dye\'s test', Object.keys(W.g.__thornswoodMinted).join() === 'hair dye');
}
{
  const SET = require(path.join(REPO, 'game', 'merchant-settlement.js'));
  const snap = { entries: [{ baseId: 7, count: 2, name: 'Brown Hair Dye' }, { baseId: 7, count: 3 }] };
  const skip = (r) => r.name === 'Brown Hair Dye';
  const r = SET.takeEntries(snap, 7, 3, skip);
  yes('M8 a merchant takes plain bowls past a dye, and the dye stays', JSON.stringify(r.entries) === JSON.stringify([{ baseId: 7, count: 3 }]) &&
      JSON.stringify(r.inventory.entries) === JSON.stringify([{ baseId: 7, count: 2, name: 'Brown Hair Dye' }]), JSON.stringify(r));
  let threw = '';
  try { SET.takeEntries(snap, 7, 4, skip); } catch (e) { threw = e.message; }
  yes('M9 ...and never a dye to make up the count', /not carrying/.test(threw), threw);
  let plain = null;
  try { plain = SET.takeEntries(snap, 7, 4); } catch (e) { plain = null; }
  yes('M9b with no skip it is as it was, by the record', !!plain && plain.entries.length === 2);
  const MT = read('game/merchant-trading.js');
  yes('M10 the merchant counts, carry and take all ask minted', /if \(minted\(entry\)\) return;/.test(MT) &&
      /!minted\(entries\[i\]\)\) n \+=/.test(MT) && /asked\.count : gold, minted\)/.test(MT) && /minted: minted,/.test(MT));
  yes('M11 the gamemode hands merchants mintedEntry, and the bundle matches', /minted: mintedEntry,/.test(gm) &&
      cp.spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dev', 'Build-MerchantGamemode.js'), '--check'], { cwd: REPO }).status === 0);
}
{
  // The take limit's stack: one record AND one name, the smallest that could give.
  const stackSrc = lift('  function stackOf(refrId, baseId, n) {', '\n  }\n');
  const box = { mp: null };
  const inv = { entries: [{ baseId: 7, count: 3, name: 'Brown Hair Dye' }, { baseId: 7, count: 40 }, { baseId: 9, count: 5 }] };
  box.mp = { get: () => inv };
  vm.runInNewContext(stackSrc + '\nthis.stackOf = stackOf;', box);
  yes('L1 the take limit finds stackOf by name', !!stackSrc && typeof box.stackOf === 'function');
  yes('L2 taking 10 of the record counts the stack of 40', box.stackOf(1, 7, 10) === 40);
  yes('L3 taking 1 counts the smallest stack that could give it, the 3 dyes', box.stackOf(1, 7, 1) === 3);
  yes('L4 one name on a record is the whole stack, as before', box.stackOf(1, 9, 2) === 5);
  yes('L5 the take limit hands it the count', /var stack = stackOf\(sourceRefrId, baseId, n\);/.test(gm));
}

// ------------------------------------------------------ R: words and router
{
  const words = /const WORDS = (\[[\s\S]*?\]);/.exec(gm), pw = /const PLAYER_WORDS = (\[[\s\S]*?\]);/.exec(gm);
  const WORDS = words ? new Function('return ' + words[1])() : [], PW = pw ? new Function('return ' + pw[1])() : [];
  yes('R1 /hairdye is in WORDS', WORDS.indexOf('/hairdye') >= 0);
  yes('R2 ...and not in PLAYER_WORDS: K and P send it, nobody types it', PW.length > 0 && PW.indexOf('/hairdye') < 0);
  yes('R3 the router hands /hairdye to the block with the character', /if \(word === '\/hairdye'\) \{\s*if \(!needCharacter\(\)\) \{ return; \}[\s\S]{0,300}hairDye\.command\(parts, actorId\)/.test(gm));
  yes('R4 /yes has the dye branch, through accept', /o\.kind === 'dye'[\s\S]{0,400}hdYes\.accept\(actorId, themActor, o\)/.test(gm));
  yes('R5 no slash command is offered in the help or the docs', !/\/hairdye/.test(read('docs/systems/hair-dye.md')));
}

// ------------------------------------------------------------ U: the panels
{
  const SK = read('game/ui/thornswood-skills.js'), PA = read('game/ui/thornswood-party.js'), FR = read('game/plugins/thornswood-front.js');
  yes('U1 K has a Hair dye page, only with the server\'s hairDye', /hairdye: \{\s*title: 'Hair dye'/.test(SK) &&
      /if \(!creating\(\) && dyeView\(\)\) sections\.push\('hairdye'\)/.test(SK));
  yes('U2 Dye my hair sends /hairdye self, Offer to dye sends /hairdye offer', /'\/hairdye self ' \+ d\.id/.test(SK) &&
      /'\/hairdye offer ' \+ who\.id \+ ' ' \+ d\.id/.test(SK));
  yes('U3 K takes the look prompt\'s person through dyeFor', /dyeFor: function \(who\)/.test(SK) && /dyeTarget = null;   \/\/ and the same/.test(SK));
  yes('U4 P has Dye hair only with dyes, and its words', /dyeButtons\(nr\.id\)/.test(PA) && /verb === 'dye'\) \{ net\('\/hairdye offer '/.test(PA) &&
      /kind === 'dye'\) \{ return 'offers to dye your hair with '/.test(PA) && /data\.offer\.kind === 'dye' \? 'offers to dye your hair with '/.test(PA));
  yes('U5 the look prompt offers Dye their hair on hd, and K is Take on\'s first', /row\.hd && !\(Array\.isArray\(row\.a\)/.test(FR) &&
      /'\|' \+ \(row\.hd \|\| 0\) \+/.test(FR) &&
      FR.indexOf('apprenticePress()) { return; }') < FR.indexOf('hairDyePress()) { return; }') && /(?:const|let) HAIR_DYE_KEY = SKILLS_KEY;/.test(FR));
  yes('U6 the front does not poll the hair colour: the redraw belongs to the engine fork', !/guard\('hair colour'/.test(FR) &&
      !/hairReadAt|hairSeen/.test(FR));
  // The panels run in a browser; make sure what was added parses.
  [['game/ui/thornswood-skills.js', SK], ['game/ui/thornswood-party.js', PA], ['game/plugins/thornswood-front.js', FR]].forEach((p) => {
    let ok = true; try { new vm.Script(p[1], { filename: p[0] }); } catch (e) { ok = false; }
    yes('U7 ' + p[0] + ' parses', ok);
  });
  const doc = read('docs/systems/hair-dye.md');
  yes('U8 no long dash and no word the house style keeps out', ![blockSrc, doc].some((s) => s.indexOf('\u2014') >= 0) &&
      !/\bplayers?\b/i.test(doc));
}

// --------------------------------------------------------------- workflow
{
  yes('X1 build.yml runs this harness (it is not in tests/gate-excluded.txt, #3009)', !/^test-2675-hair-dye-wiring\.js\s/m.test(read('tests/gate-excluded.txt')));
}
done();
