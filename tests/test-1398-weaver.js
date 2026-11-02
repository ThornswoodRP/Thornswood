// test-1398-weaver.js
//
// #1398, Master Weaver's two halves. Patrick's answers of 4 October: the
// tailor picks one per garment, warmth or armour; armour gives back 10% of
// each hit, the way the warrior's Wall does it; and one woven garment counts,
// two do not stack. tests/test-1398-fuel.js holds the craft writing the mark
// and the warmth reading its own; this holds the rest:
//
//   A  the pick, through the real character block: the K view carries weave
//      for a Master Weaver and for nobody else, the line the card sends keeps
//      it on the character, and what is refused
//   B  the 10%, through the real warrior maneuvers block over a fake mp, on
//      the same measured path as the Wall: one garment, two, a warm one, an
//      enchanted one, one at 85%, one in the pack, somebody who is not a
//      person, a Wall on top, and a blow that kills
//   C  the K panel's profession card in a stand-in document: Warmth and
//      Armour, the lit one, the press that sends, the answer and a refusal
//   D  the page, the numbers and the words: the tailor page against the
//      code, and nobody told to type the line
//
// Read only. Drives the real blocks out of gamemode.js and the real page out
// of game/ui/thornswood-skills.js.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read(...bits) { return fs.readFileSync(path.join(REPO, ...bits), 'utf8').split(CR).join(''); }
const gm = require('./gamemode-tables.js').joined(read('game', 'gamemode.js'));
const ui = read('game', 'ui', 'thornswood-skills.js');
const page = read('docs', 'systems', 'professions', 'tailor.md');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.stack ? e.stack : e), false); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function between(text, a, b) {
  const i = text.indexOf(a);
  const j = i < 0 ? -1 : text.indexOf(b, i);
  return (i >= 0 && j >= 0) ? text.slice(i, j) : null;
}

const RULES = between(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
const MANEUVERS = between(gm, '// ==== thornswood warrior maneuvers ====', '// ==== end thornswood warrior maneuvers ====');
const NEEDS_WOVEN = /woven: \{ degrees: (\d+), mark: '([^']+)' \}/.exec(gm);
yes('the rules, the character block, the maneuvers block and the weather mark are in the gamemode',
    !!(RULES && CHARACTER && MANEUVERS && NEEDS_WOVEN));
if (!(RULES && CHARACTER && MANEUVERS && NEEDS_WOVEN)) { done(); }

// ------------------------------------------------------------ A. the pick --
const store = {};
const said = [];
const mpA = {
  makeProperty: function () { },
  get: function (id, key) {
    const p = store[id] || {};
    return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
  },
  set: function (id, key, value) { (store[id] = store[id] || {})[key] = JSON.stringify(value); }
};
const ctxA = {
  mp: mpA, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
  isFinite: isFinite, parseInt: parseInt,
  console: { log: function () { }, error: function () { } },
  guard: function (name, fn) { return fn; },
  setInterval: function () { return 1; }, clearInterval: function () { },
  notify: function () { }, say: function () { }, log: function () { },
  spellOn: function () { return true; }, giveTool: function () { return null; }, raceOf: function () { return ''; },
  // The two blocks the line reads its numbers from, as the gamemode has them.
  __thornswoodNeeds: { NEEDS: { wear: { woven: { degrees: Number(NEEDS_WOVEN[1]), mark: NEEDS_WOVEN[2] } } } }
};
ctxA.globalThis = ctxA;
vm.createContext(ctxA);
vm.runInContext(RULES, ctxA, { filename: 'gamemode.js rules' });
vm.runInContext(CHARACTER, ctxA, { filename: 'gamemode.js character' });
const P = ctxA.__thornswoodProgression;
const C = ctxA.__thornswoodCharacter;
yes('A: the character block registered with weaveOf', !!C && typeof C.weaveOf === 'function' && typeof C.command === 'function');

// The real WOVEN off the maneuvers block, for the line and the craft.
const wovenLine = /var WOVEN = (\{ mark: '[^']+', less: [0-9.]+ \});/.exec(MANEUVERS);
const WOVEN = wovenLine ? new Function('return ' + wovenLine[1])() : null;
yes('A: the maneuvers block has the armour mark and the share', !!WOVEN && typeof WOVEN.mark === 'string' && WOVEN.less > 0);
ctxA.__thornswoodManeuvers = { WOVEN: WOVEN };

function person(id, pid, prof, half, rank) {
  store[id] = { profileId: JSON.stringify(pid), worldOrCellDesc: JSON.stringify('town:X.esm'), pos: JSON.stringify([0, 0, 0]) };
  let s = C.stateOf(id);
  let r = P.pickClass(s, 'miner');
  if (r.ok) { s = r.state; }
  if (prof) {
    r = P.pickProfession(s, prof, half);
    if (r.ok) { s = r.state; }
    if (rank) { s.ranks[half] = rank; }
  }
  C.writeState(id, s);
  return id;
}
function view(id) { return C.forPanel(C.stateOf(id), false, id); }
function send(id, text) {
  said.length = 0;
  const parts = text.trim().split(/\s+/);
  const handled = C.command(parts[0], parts, id, Number(JSON.parse(store[id].profileId)), function (p, m) { said.push(m); });
  return handled ? said.slice() : null;
}
const WEAVER = 0xff000301, TAILOR = 0xff000302, SMITH = 0xff000303, LIVERY = 0xff000304;
person(WEAVER, 301, 'tailor', 'haberdasher', 'master');
person(TAILOR, 302, 'tailor', 'haberdasher', 'expert');
person(SMITH, 303, 'smith', 'edgewright', 'master');
person(LIVERY, 304, 'tailor', 'liverywright', 'master');

attempt('A: the pick', function () {
  yes('A1: a master Haberdasher holds Master Weaver', P.perks(C.stateOf(WEAVER)).indexOf('masterweaver') !== -1);
  yes('A1: their K view carries weave, and it starts on warmth', view(WEAVER).weave === 'warmth');
  yes('A1: so does a master Liverywright\'s: the perk is the tailor\'s at master, either half', view(LIVERY).weave === 'warmth');
  yes('A1: an expert tailor and a master smith have no weave on their view', !('weave' in view(TAILOR)) && !('weave' in view(SMITH)));
  yes('A1: and none while creating', !('weave' in C.forPanel(C.stateOf(WEAVER), true, WEAVER)));

  let lines = send(WEAVER, '/pick weave armour');
  yes('A2: the Armour button\'s line is answered', lines !== null);
  yes('A2: it is kept on the character', C.stateOf(WEAVER).weave === 'armour' && C.weaveOf(C.stateOf(WEAVER)) === 'armour');
  yes('A2: and the view says armour now', view(WEAVER).weave === 'armour');
  yes('A2: the person is told what it does, in the numbers the code uses (' + lines.join(' | ') + ')',
      lines.length === 1 && lines[0] === 'The garments you make now carry hidden armour: one worn gives back ' +
      Math.round(WOVEN.less * 100) + '% of each hit. They do not keep the weather off.');
  const written = mpA.get(WEAVER, C.PROPERTY);
  yes('A2: and the panel the write sends to K carries it', !!written && !!written.panel && written.panel.weave === 'armour');
  lines = send(WEAVER, '/pick weave warmth');
  yes('A3: Warmth takes it back (' + lines.join(' | ') + ')', C.stateOf(WEAVER).weave === 'warmth' && view(WEAVER).weave === 'warmth' &&
      lines[0] === 'The garments you make now keep the weather off: one worn ignores ' + NEEDS_WOVEN[1] +
      ' degrees of exposure. They carry no hidden armour.');
  send(WEAVER, '/pick weave ARMOUR');
  yes('A3: case does not matter', C.stateOf(WEAVER).weave === 'armour');

  lines = send(TAILOR, '/pick weave armour');
  yes('A4: an expert tailor is refused, and told why (' + lines.join(' | ') + ')',
      lines[0] === 'No: only a Master Weaver picks what a garment carries.');
  yes('A4: nothing is kept, and the note says which pick it answers',
      C.stateOf(TAILOR).weave === undefined && C.stateOf(TAILOR).note && C.stateOf(TAILOR).note.about === 'weave');
  lines = send(SMITH, '/pick weave armour');
  yes('A4: so is a master smith', /^No: only a Master Weaver/.test(lines[0]) && C.stateOf(SMITH).weave === undefined);
  lines = send(WEAVER, '/pick weave both');
  yes('A5: a garment carries one of the two, and a third word is refused (' + lines.join(' | ') + ')',
      lines[0] === 'No: a garment carries warmth or armour.' && C.stateOf(WEAVER).weave === 'armour');
  lines = send(WEAVER, '/pick weave');
  yes('A5: and so is no word at all', lines[0] === 'No: a garment carries warmth or armour.' && C.stateOf(WEAVER).weave === 'armour');
  // weaveOf answers from the rules, so a stored word can never make somebody a weaver.
  const forged = P.clone(C.stateOf(TAILOR));
  forged.weave = 'armour';
  yes('A6: a stored weave on somebody without the perk counts for nothing', C.weaveOf(forged) === null);
  const odd = P.clone(C.stateOf(WEAVER));
  odd.weave = 'plate';
  yes('A6: and a word that is not armour on a weaver is warmth', C.weaveOf(odd) === 'warmth');
});

// ------------------------------------------------------------- B. the 10% --
const clock = { t: 1000000 };
const world = { actors: new Map(), timers: [] };
function desc(id) { return id.toString(16) + ':run'; }
function actor(id, o) {
  world.actors.set(id, Object.assign({ pid: id > 0xff000000 && id < 0xff001000 ? id - 0xff000000 : -1, dead: false,
    p: { health: 1, magicka: 1, stamina: 1 }, pos: [0, 0, 0], cell: 'cell:Skyrim.esm', worn: [], eqReadable: true,
    race: '13746:Skyrim.esm', base: '7:Skyrim.esm', online: true }, o || {}));
  return id;
}
const SPELL = 0x5ee;
/*
  The records the engine works the most stamina out of, as
  test-1386-warrior.js gives them: a race that starts it at 50 and a base
  that adds 50, so the Wall's 40 can be spent.
*/
const NORD = 0x13746, PERSON_BASE = 0x7;
function raceData(start) { const b = Buffer.alloc(104); b.writeFloatLE(start, 44); return new Uint8Array(b); }
function acbs(offset) { const b = Buffer.alloc(24); b.writeInt16LE(offset, 6); return new Uint8Array(b); }
const RECORDS = {};
RECORDS[NORD] = { type: 'RACE', fields: [{ type: 'DATA', data: raceData(50) }] };
RECORDS[PERSON_BASE] = { type: 'NPC_', fields: [{ type: 'ACBS', data: acbs(50) }] };
const mpB = {
  getNpcAIState: function(id) {
    const a=world.actors.get(id);
    return a ? {isHuman:a.pid>0,profileId:a.pid,lifeGeneration:a.life || 0,runtimeLifeIdentity:String(1+(a.body || 0))} : null;
  },
  get: function (id, prop) {
    if (id === 0 && prop === 'onlinePlayers') {
      return Array.from(world.actors.keys()).filter(function (k) { return world.actors.get(k).pid > 0; });
    }
    const a = world.actors.get(id);
    if (!a) { throw new Error('no actor ' + id); }
    if (prop === 'percentages') { return Object.assign({}, a.p); }
    if (prop === 'pos') { return a.pos.slice(); }
    if (prop === 'worldOrCellDesc') { return a.cell; }
    if (prop === 'isDead') { return a.dead; }
    if (prop === 'profileId') { return a.pid; }
    if (prop === 'isOnline') { return a.online; }
    if (prop === 'lastAnimEvent') { return null; }
    if (prop === 'baseDesc') { return a.base; }
    if (prop === 'equipment') {
      if (!a.eqReadable) { throw new Error('equipment not readable'); }
      return { inv: { entries: a.worn.filter(function (e) { return e.worn; }) } };
    }
    if (prop === 'inventory') { return { entries: a.worn.slice() }; }
    throw new Error('no ' + prop);
  },
  set: function (id, prop, v) {
    const a = world.actors.get(id);
    if (prop === 'percentages') {
      a.p = { health: v.health, magicka: v.magicka, stamina: v.stamina };
      if (v.health === 0) { a.dead = true; }
    }
  },
  getDescFromId: desc,
  getIdFromDesc: function (d) { return parseInt(String(d).split(':')[0], 16); },
  lookupEspmRecordById: function (id) {
    if (Object.prototype.hasOwnProperty.call(RECORDS, id)) { return { record: RECORDS[id] }; }
    return { record: { type: id === SPELL ? 'SPEL' : 'WEAP', fields: [] } };
  },
  callPapyrusFunction: function (type, cls, fn, self, args) {
    if (fn === 'GetRace') { return { type: 'espm', desc: world.actors.get(parseInt(self.desc, 16)).race }; }
    if (fn === 'DamageActorValue') {
      const a = world.actors.get(parseInt(self.desc, 16));
      a.p.stamina = Math.max(0, a.p.stamina - args[1] / 100);
    }
    return null;
  }
};
const states = new Map();
const party = { leader: 1, members: [] };
const boxB = {
  MERCHANT_TRADING: require('../game/quest-transactions'),
  console: { log: function () { } },
  Buffer: Buffer,
  mp: mpB,
  guard: function (n, fn) { return fn; },
  setTimeout: function (fn, ms) { world.timers.push({ fn: fn, at: clock.t + (ms || 0) }); return world.timers.length; },
  setInterval: function () { return 1; },
  clearInterval: function () { },
  __thornswoodCharacter: {
    stateOf: function (id) { return states.get(id) || null; },
    writeState: function (id, s) { return s; },
    effectsOf: function () { return {}; }
  },
  __thornswoodSocial: {
    profileOf: function (id) { const a = world.actors.get(id); return a && a.pid > 0 ? a.pid : 0; },
    partyOf: function (pid) { return party.members.indexOf(pid) !== -1 ? party : null; },
    nameOfPerson: function (id) { return 'Person ' + (id - 0xff000000); }
  }
};
boxB.globalThis = boxB;
vm.createContext(boxB);
boxB.__clock = clock;
vm.runInContext('Date.now = function () { return __clock.t; };', boxB);
vm.runInContext(RULES, boxB);
vm.runInContext(MANEUVERS, boxB);
const M = boxB.__thornswoodManeuvers;
yes('B: the maneuvers block registered, with the woven armour', !!M && typeof M.hit === 'function' && !!M.WOVEN &&
    typeof boxB.mp['onPapyrusEvent:OnHit'] === 'function');

function later(ms) {
  clock.t += ms;
  world.timers.sort(function (a, b) { return a.at - b.at; });
  while (world.timers.length && world.timers[0].at <= clock.t) { world.timers.shift().fn(); }
  M.tick();
}
function strike(by, target, took, opts) {
  opts = opts || {};
  boxB.mp['onPapyrusEvent:OnHit'](target, { type: 'form', desc: desc(by) },
    { type: 'espm', desc: (opts.spell ? SPELL : 0x1f4).toString(16) + ':Skyrim.esm' }, null, false, false, false, false);
  // The engine's own damage, after the event, the way OnWeaponHit runs.
  const a = world.actors.get(target);
  a.p.health = Math.max(0, a.p.health - took);
  if (a.p.health === 0) { a.dead = true; }
  later(0);
}
function health(id) { return Math.round(world.actors.get(id).p.health * 10000) / 10000; }
function heal(id) { const a = world.actors.get(id); a.p.health = 1; a.dead = false; }
function wear(id, list) { world.actors.get(id).worn = list.map(function (e) { return Object.assign({ baseId: 0x100 + list.indexOf(e), count: 1, worn: true }, e); }); }
const LINED = WOVEN.mark, WARM = NEEDS_WOVEN[2];

const WOLF = actor(0xff800001, { pid: -1 });
const A1 = actor(0xff000011);
const NPC = actor(0xff800002, { pid: -1 });
const BUL = actor(0xff000012);
attempt('B: the 10%', function () {
  yes('B1: the share is a tenth, and the mark is not the weather\'s', M.WOVEN.less === 0.1 &&
      LINED.indexOf(WARM) !== 0 && WARM.indexOf(LINED) !== 0);
  wear(A1, [{ name: 'Fine Clothes' }]);
  strike(WOLF, A1, 0.5);
  yes('B2: plain clothes give nothing back: 0.5 is 0.5', health(A1) === 0.5);
  heal(A1);
  wear(A1, [{ name: LINED + 'Fine Clothes' }]);
  strike(WOLF, A1, 0.5);
  yes('B2: a garment woven for armour gives back a tenth: 0.5 becomes 0.45 (' + health(A1) + ')', health(A1) === 0.55);
  heal(A1);
  wear(A1, [{ name: LINED + 'Fine Clothes' }, { name: LINED + 'Hood' }, { name: LINED + 'Boots' }]);
  strike(WOLF, A1, 0.5);
  yes('B3: three of them still give back a tenth, not three (' + health(A1) + ')', health(A1) === 0.55);
  heal(A1);
  wear(A1, [{ name: WARM + 'Fine Clothes' }]);
  strike(WOLF, A1, 0.5);
  yes('B4: a garment woven for warmth carries no armour', health(A1) === 0.5);
  heal(A1);
  wear(A1, [{ name: WARM + 'Fine Clothes' }, { name: LINED + 'Hood' }]);
  strike(WOLF, A1, 0.5);
  yes('B4: one of each worn: the armour one counts', health(A1) === 0.55);
  heal(A1);
  wear(A1, [{ name: LINED + 'Fine Clothes', enchantmentId: 7 }]);
  strike(WOLF, A1, 0.5);
  yes('B5: a piece named that at the enchanting table is not woven', health(A1) === 0.5);
  heal(A1);
  wear(A1, [{ name: LINED + 'Fine Clothes (85%)' }]);
  strike(WOLF, A1, 0.5);
  yes('B5: a woven piece at 85% is still woven', health(A1) === 0.55);
  heal(A1);
  wear(A1, [{ name: LINED + 'Fine Clothes', worn: false }]);
  strike(WOLF, A1, 0.5);
  yes('B6: one in the pack and not worn gives nothing', health(A1) === 0.5);
  heal(A1);
  world.actors.get(A1).eqReadable = false;
  wear(A1, [{ name: LINED + 'Fine Clothes' }]);
  strike(WOLF, A1, 0.5);
  yes('B6: with the equipment unreadable, what the pack says is worn is read', health(A1) === 0.55);
  world.actors.get(A1).eqReadable = true;
  heal(A1);
  wear(A1, [{ name: LINED + 'Fine Clothes' }]);
  strike(WOLF, A1, 0.5, { spell: true });
  yes('B7: a spell is a hit too, as it is for the Wall', health(A1) === 0.55);
  heal(A1);
  wear(NPC, [{ name: LINED + 'Fine Clothes' }]);
  strike(A1, NPC, 0.5);
  yes('B8: somebody who is not a person gets nothing from one', health(NPC) === 0.5);
  heal(NPC);
  world.actors.get(A1).p.health = 0.3;
  wear(A1, [{ name: LINED + 'Fine Clothes' }]);
  strike(WOLF, A1, 0.4);
  yes('B9: a blow that kills outright is not softened, the way the Wall\'s is not', world.actors.get(A1).dead === true && health(A1) === 0);
  heal(A1);
  world.actors.get(A1).p.health = 0.5;
  strike(WOLF, A1, 0.2);
  yes('B9: and a blow that leaves something is: 0.5 less 0.2 is 0.32 (' + health(A1) + ')', health(A1) === 0.32);
  heal(A1);

  // The Wall on top: the two add.
  const bul = P.pickProfession(P.fresh(), 'warrior', 'bulwark').state;
  bul.ranks.bulwark = 'master';
  states.set(BUL, bul);
  const wallSaid = M.use(BUL, 'wall');
  yes('B10: Wall starts (' + wallSaid + ')', /^Wall, for 10 seconds\./.test(wallSaid));
  wear(BUL, [{ name: LINED + 'Fine Clothes' }]);
  strike(WOLF, BUL, 0.5);
  yes('B10: a Bulwark under their own Wall in a woven-for-armour garment gets 30% back: 0.5 becomes 0.35 (' + health(BUL) + ')',
      health(BUL) === 0.65);
  heal(BUL);
  wear(BUL, [{ name: 'Fine Clothes' }]);
  strike(WOLF, BUL, 0.5);
  yes('B10: without the garment the Wall is its own 20%', health(BUL) === 0.6);
  heal(BUL);
  later(10100);
  wear(BUL, [{ name: LINED + 'Fine Clothes' }]);
  strike(WOLF, BUL, 0.5);
  yes('B10: and once the Wall is down, the garment is still its tenth', health(BUL) === 0.55);
  heal(BUL);
});

// --------------------------------------------- C. the K panel's card --
attempt('C: the card', function () {
  const sentPage = [];
  function node(tag) {
    const n = { tag: tag, children: [], style: {}, className: '', _text: '', id: '', onclick: null, title: '' };
    Object.defineProperty(n, 'textContent', {
      get: function () { return n._text + n.children.map(function (c) { return c.textContent; }).join(''); },
      set: function (v) { n._text = String(v); n.children = []; }
    });
    n.appendChild = function (c) { n.children.push(c); return c; };
    n.querySelector = function (sel) { return (n._q && n._q[sel]) || node('div'); };
    return n;
  }
  const docu = {
    head: node('head'), body: node('body'),
    createElement: function (tag) {
      const n = node(tag);
      Object.defineProperty(n, 'innerHTML', { set: function () {
        const close = node('div'); close._q = { span: node('span'), '.key': node('span') };
        n._q = { '.title': node('div'), '.who': node('div'), '.nav': node('div'), '.body': node('div'),
                 '.status': node('div'), '[data-act="confirm"]': node('div'), '[data-act="close"]': close, '.panel': node('div') };
      } });
      return n;
    },
    createTextNode: function (t) { const n = node('#text'); n._text = String(t); return n; }
  };
  const timers = [];
  const win = { innerWidth: 1920, innerHeight: 1080, addEventListener: function () { },
                skyrimPlatform: { sendMessage: function (to, m) { sentPage.push(m); } },
                thornswoodNet: { say: function () { } } };
  let now = Date.now();
  const FakeDate = function () { return new Date(now); };
  FakeDate.now = function () { return now; };
  const box = { window: win, document: docu, setTimeout: function (fn, ms) { timers.push({ fn: fn, at: now + ms }); },
                Date: FakeDate, JSON: JSON, console: console };
  vm.createContext(box);
  let ran = true;
  try { vm.runInContext(ui, box, { filename: 'thornswood-skills.js' }); } catch (e) { ran = false; console.log(e); }
  const api = win.thornswoodSkills;
  yes('C0: the K panel runs in a stand-in document', ran && !!api);
  if (!api) { return; }
  const root = docu.body.children[0];
  const body = root._q['.body'], status = root._q['.status'];
  const all = function (n, out) { out = out || []; out.push(n); n.children.forEach(function (c) { all(c, out); }); return out; };
  const choice = function (name) {
    return all(body).filter(function (n) { return /\bhalf\b/.test(n.className) && n.children.length && n.children[0].textContent === name; })[0];
  };
  const picks = function () { return sentPage.filter(function (m) { return /^skills:pick /.test(m); }); };

  send(WEAVER, '/pick weave warmth');
  api.open();
  sentPage.length = 0;
  api.setData(null, { panel: view(TAILOR) });
  yes('C1: an expert tailor\'s card has no Warmth or Armour', !choice('Warmth') && !choice('Armour'));
  api.setData(null, { panel: view(WEAVER) });
  const warmth = choice('Warmth'), armour = choice('Armour');
  yes('C2: a Master Weaver\'s own card has Warmth and Armour, and says what each does (' + (armour ? armour.textContent : '') + ')',
      !!warmth && !!armour && /4 degrees/.test(warmth.textContent) && /10% of each hit/.test(armour.textContent));
  yes('C2: Warmth is lit, because that is what the server holds', /\bmine\b/.test(warmth.className) && !/\bmine\b/.test(armour.className));
  warmth.onclick({ stopPropagation: function () { } });
  yes('C3: a press on the lit one sends nothing', picks().length === 0);
  armour.onclick({ stopPropagation: function () { } });
  yes('C3: a press on Armour sends the pick, once (' + picks().join(' | ') + ')', picks().length === 1 && picks()[0] === 'skills:pick weave armour');
  choice('Armour').onclick({ stopPropagation: function () { } });
  yes('C3: a second press while it is in flight sends nothing more', picks().length === 1);
  // Through the server, the way the front plugin turns it into /pick.
  send(WEAVER, '/' + picks()[0].slice('skills:'.length));
  api.setData(null, { panel: view(WEAVER) });
  yes('C4: the answer lights Armour and says so (' + status.textContent + ')',
      /\bmine\b/.test(choice('Armour').className) && !/\bmine\b/.test(choice('Warmth').className) &&
      /carry hidden armour/.test(status.textContent));
  sentPage.length = 0;
  choice('Warmth').onclick({ stopPropagation: function () { } });
  yes('C5: and Warmth can be pressed again straight away', picks().length === 1 && picks()[0] === 'skills:pick weave warmth');
  // A refusal clears the pick it is about.
  const refusedView = Object.assign(view(WEAVER), { note: { text: 'a garment carries warmth or armour', at: now + 1, about: 'weave' } });
  api.setData(null, { panel: refusedView });
  yes('C6: a refusal about weave is shown (' + status.textContent + ')', /No: a garment carries warmth or armour/.test(status.textContent));
  sentPage.length = 0;
  choice('Warmth').onclick({ stopPropagation: function () { } });
  yes('C6: and clears the pick, so Warmth can be sent again', picks().length === 1);
  api.close();
});

// ----------------------------------------------------- D. the page and words --
attempt('D: the page', function () {
  const mw = between(page, '## Master Weaver', '## What you are handed') || '';
  yes('D1: the tailor page says the tailor picks one per garment, warmth or armour', /picks one per garment, warmth or armour, never both/.test(mw));
  yes('D1: and that the pick is on K, with nothing typed', /The pick is on K/.test(mw) && /Nothing is typed/.test(mw) && !/\/pick/.test(page));
  yes('D2: the page\'s 10% is the code\'s share, and its 4 degrees the weather\'s', /gives back 10% of each hit/.test(mw) &&
      Math.round(WOVEN.less * 100) === 10 && /4 degrees of exposure ignored/.test(mw) && NEEDS_WOVEN[1] === '4');
  yes('D2: the page names both marks as the code writes them', mw.indexOf('named ' + WOVEN.mark.trim()) !== -1 &&
      mw.indexOf('named ' + NEEDS_WOVEN[2].trim()) !== -1);
  yes('D3: the page says one is enough for each half', /Two do not ignore 8/.test(mw) && /two give back 10%, not\s+20%/.test(mw));
  yes('D4: the page says a drop loses the mark until #1719', /#1719/.test(mw));
  yes('D5: the card\'s words carry the server\'s numbers', /'One worn ignores 4 degrees of the weather\.'/.test(ui) &&
      /one worn gives back 10% of each hit\./.test(ui));
  // Nobody is told to type it: the list named to everybody and the help never name it.
  const help = between(gm, '// ==== thornswood chat commands ====', '// ==== end thornswood chat commands ====') || '';
  yes('D6: no help text in the chat commands block names weave', help.length > 1000 && !/weave/i.test(help));
  const lines = [];
  [WEAVER, TAILOR].forEach(function (id) { ['/pick weave armour', '/pick weave warmth', '/pick weave x'].forEach(function (t) { (send(id, t) || []).forEach(function (l) { lines.push(l); }); }); });
  yes('D6: no line the server says names /pick', lines.length > 0 && lines.every(function (l) { return !/\/pick|\/weave/.test(l); }));
  yes('D7: no line says the banned word or carries an em dash', lines.every(function (l) { return !/play[e]r/i.test(l) && l.indexOf(String.fromCharCode(0x2014)) === -1; }));
});

done();
