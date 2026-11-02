// test-1387-college.js
//
// #1387. docs/systems/magic.md, docs/systems/potions.md,
// docs/systems/professions/mage/conjuration.md and apprenticeship.md:
//
//   A semester grants the written points once: a mage 2, somebody a Master
//   mage taught 1 for a Novice spell of their school, once in 24 hours of
//   real time, only at a study desk in the College halls, and the clock
//   survives a relog and a restart. Nobody types it: E at the desk is the
//   semester (Patrick, 22 Oct 2026, A), and the College page on K says
//   where the desks are.
//   An off-book spell does not stay: a tome refuses it, one a tome taught
//   before comes off at login, and one a mod's menu put in a hand is taken
//   back.
//   Dead Thrall does not take a person: a reanimate spell on a person's body
//   is refused by the server, which puts the body back down.
//   Restoration strain matches the page: 25% more each cast inside 30
//   seconds, the fifth refused for 20 seconds at the weary cold recovery.
//   Withered matches the page: five potions or ten restoration casts in an
//   hour, 30 real minutes at 80% of max health and magicka, kept over a
//   relog and a restart, and over when the 30 minutes are (the cooked meal
//   that also clears it waits for #1382).
//
// Traps: the two-spell cap and the tome gates are the ones already there,
// and there is no second spell list. The refusal of Dead Thrall is the
// server's, not only a scene rule.
//
// This runs the real blocks out of game/gamemode.js in one sandbox over a fake
// mp that keeps properties as JSON the way the server does: the rules, the
// character store and its /pick, the spell tomes block and the college block,
// with a small fake load order for the records. A second server over the same
// store is a restart.
//
// Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(REPO, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');
const ui = fs.readFileSync(path.join(REPO, 'game', 'ui', 'thornswood-skills.js'), 'utf8').split(CR).join('');
function doc(p) { return fs.readFileSync(path.join(REPO, 'docs', 'systems', p), 'utf8').split(CR).join(''); }
const doors = JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'doors.json'), 'utf8'));

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
  return (i >= 0 && j >= 0) ? src.slice(i, j + b.length) : null;
}

const RULES = between('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between('// ==== thornswood character ====', '// ==== end thornswood character ====');
const TOMES = between('// ==== thornswood spell tomes ====', '// ==== end thornswood spell tomes ====');
const COLLEGE = between('// ==== thornswood college ====', '// ==== end thornswood college ====');
const ONHIT = between("mp['onPapyrusEvent:OnHit'] = guard(", '\n});');
const ok = RULES && CHARACTER && TOMES && COLLEGE && ONHIT;
yes('the rules, the character store, the tomes block, the college block and the OnHit handler are in the gamemode', !!ok);
if (!ok) { done(); }

// ------------------------------------------------------- a fake load order --
const PLUG = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm',
              'Apocalypse - Magic of Skyrim.esp', 'PlayFluteLuteDrum.esp', 'Thornswood-Content.esp'];
function idOf(desc) {
  const at = String(desc).indexOf(':');
  if (at < 0) { return parseInt(String(desc), 16) >>> 0; }   // a form the server made, as the engine writes it
  const i = PLUG.indexOf(String(desc).slice(at + 1));
  return i < 0 ? 0 : (i * 0x1000000 + parseInt(String(desc).slice(0, at), 16)) >>> 0;
}
function descOf(id) {
  if (id >= 0xff000000) { return (id >>> 0).toString(16); }
  return (id & 0xffffff).toString(16) + ':' + PLUG[Math.floor(id / 0x1000000)];
}
function bytes(n) { return new Array(n).fill(0); }
function put32(b, at, v) { v = v >>> 0; b[at] = v & 255; b[at + 1] = (v >>> 8) & 255; b[at + 2] = (v >>> 16) & 255; b[at + 3] = (v >>> 24) & 255; return b; }
function text(s) { const out = []; for (let i = 0; i < s.length; i++) { out.push(s.charCodeAt(i)); } out.push(0); return out; }

const RECORDS = {};
let nextEffect = 0x5f0000;
const AV = { alteration: 18, conjuration: 19, destruction: 20, illusion: 21, restoration: 22 };
function effect(school, archetype) {
  const id = idOf((nextEffect++).toString(16) + ':Apocalypse - Magic of Skyrim.esp');
  const data = bytes(0x48);
  put32(data, 12, school ? AV[school] : -1);
  put32(data, 40, 0);
  put32(data, 0x40, archetype || 0);
  RECORDS[id] = { type: 'MGEF', editorId: 'E' + id, fields: [{ type: 'DATA', data: data }] };
  return id;
}
/* A SPEL: its name, the SPIT type (0 spell, 1 disease, 2 power, 4 ability), its school, and the archetype of its effect. */
function spell(desc, name, type, school, archetype) {
  const spit = bytes(36);
  put32(spit, 8, type);
  RECORDS[idOf(desc)] = { type: 'SPEL', editorId: name.replace(/\W/g, ''),
    fields: [{ type: 'FULL', data: text(name) }, { type: 'SPIT', data: spit },
             { type: 'EFID', data: put32(bytes(4), 0, effect(school, archetype)) }] };
  return desc;
}
function scroll(desc, name, archetype) {
  RECORDS[idOf(desc)] = { type: 'SCRL', editorId: name.replace(/\W/g, ''),
    fields: [{ type: 'FULL', data: text(name) }, { type: 'EFID', data: put32(bytes(4), 0, effect('conjuration', archetype)) }] };
  return desc;
}
function staff(desc, enchDesc, archetype) {
  RECORDS[idOf(enchDesc)] = { type: 'ENCH', editorId: 'Ench', fields: [{ type: 'EFID', data: put32(bytes(4), 0, effect('conjuration', archetype)) }] };
  RECORDS[idOf(desc)] = { type: 'WEAP', editorId: 'Staff', fields: [{ type: 'EITM', data: put32(bytes(4), 0, idOf(enchDesc)) }] };
  return desc;
}
const REANIMATE = 22;
const FLAMES = spell('12fcd:Skyrim.esm', 'Flames', 0, 'destruction');
const SPARKS = spell('2dd2a:Skyrim.esm', 'Sparks', 0, 'destruction');
const FROSTBITE = spell('2b96b:Skyrim.esm', 'Frostbite', 0, 'destruction');
const HEALING = spell('12fcc:Skyrim.esm', 'Healing', 0, 'restoration');
const HANDS = spell('4d3f2:Skyrim.esm', 'Healing Hands', 0, 'restoration');
const THRALL = spell('7e8df:Skyrim.esm', 'Dead Thrall', 0, 'conjuration', REANIMATE);
const ZOMBIE = spell('7e8e1:Skyrim.esm', 'Raise Zombie', 0, 'conjuration', REANIMATE);
const THUNDER = spell('11111:Apocalypse - Magic of Skyrim.esp', 'Thunderclap', 0, 'destruction');
const MENDING = spell('22222:Apocalypse - Magic of Skyrim.esp', 'Mending Touch', 0, 'restoration');
const STAFFSP = spell('33333:Apocalypse - Magic of Skyrim.esp', 'Spark Staff Spell', 0, 'destruction');
const BLESSING = spell('fb988:Skyrim.esm', 'Blessing of Talos', 4, 'restoration');
const RATTLES = spell('b8780:Skyrim.esm', 'Rattles', 1, null);
const POWER = spell('44444:Apocalypse - Magic of Skyrim.esp', 'A Power Of Fire', 2, 'destruction');
const LUTE = spell('9456:PlayFluteLuteDrum.esp', 'Play Instrument', 0, 'illusion');
const SCROLL = scroll('a44a7:Skyrim.esm', 'Scroll of Dead Thrall', REANIMATE);
const RSTAFF = staff('29b76:Skyrim.esm', '55555:Apocalypse - Magic of Skyrim.esp', REANIMATE);
const DESK_BASE = '18032:Thornswood-Content.esp';
const TAMRIEL = '3c:Skyrim.esm';

/* One server process over a store; a second one over the same store is a restart. */
function server(store, opts) {
  opts = opts || {};
  const said = [];
  const calls = [];
  const timers = [];
  const made = {};
  let clock = opts.clock || 1800000000000;
  const learned = opts.learned || {};   // actor id -> [spell desc] the engine holds
  const mp = {
    makeProperty: function (name, how) { made[name] = how; },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return []; }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    set: function (id, key, value) { (store[id] = store[id] || {})[key] = JSON.stringify(value); },
    getIdFromDesc: function (d) { return idOf(d); },
    getDescFromId: function (id) { return descOf(id); },
    lookupEspmRecordById: function (id) {
      const r = RECORDS[id];
      return r ? { record: r, toGlobalRecordId: function (local) { return local; } } : null;
    },
    callPapyrusFunction: function (kind, cls, fn, self, args) {
      calls.push({ cls: cls, fn: fn, self: self && self.desc, args: args });
      const who = self ? idOf(self.desc) : 0;
      const list = learned[who] || [];
      if (fn === 'GetSpellCount') { return list.length; }
      if (fn === 'GetNthSpell') { return list[args[0]] ? { type: 'espm', desc: list[args[0]] } : null; }
      if (fn === 'RemoveSpell') { const at = list.indexOf(args[0].desc); if (at !== -1) { list.splice(at, 1); } return true; }
      if (fn === 'AddSpell') { if (list.indexOf(args[0].desc) === -1) { list.push(args[0].desc); } learned[who] = list; return true; }
      return undefined;
    }
  };
  const FakeDate = function () { return new Date(clock); };
  FakeDate.now = function () { return clock; };
  const ctx = {
    mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: FakeDate,
    isFinite: isFinite, parseInt: parseInt, Infinity: Infinity,
    console: { log: function () { }, error: function () { } },
    guard: function (name, fn) { return function () { try { return fn.apply(null, arguments); } catch (e) { return undefined; } }; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, at: clock + ms }); return timers.length; },
    notify: function () { },
    say: function (id, m) { said.push({ id: id, text: m }); },
    log: function () { },
    giveTool: function () { return null; },
    INSTRUMENT_SPELL: '9456:PlayFluteLuteDrum.esp'
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // spellOn, the real one, as the character block and the college block call it.
  vm.runInContext(between('function spellOn(actorId, spellDesc, on) {', '\n}\n'), ctx, { filename: 'spellOn' });
  vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
  vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  vm.runInContext(TOMES, ctx, { filename: 'gamemode.js tomes' });
  vm.runInContext(COLLEGE, ctx, { filename: 'gamemode.js college' });
  vm.runInContext(ONHIT, ctx, { filename: 'gamemode.js OnHit' });
  const C = ctx.__thornswoodCharacter;
  return {
    ctx: ctx, mp: mp, said: said, calls: calls, made: made, learned: learned, C: C,
    P: ctx.__thornswoodProgression, CO: ctx.__thornswoodCollege,
    at: function (t) { clock = t; },
    now: function () { return clock; },
    /* Run every timer that is due by now. */
    tick: function () {
      const due = timers.filter(function (x) { return !x.done && x.at <= clock; });
      due.forEach(function (x) { x.done = true; x.fn(); });
      return due.length;
    },
    told: function (id) { return said.filter(function (x) { return x.id === id; }).map(function (x) { return x.text; }); },
    /* E at a study desk: mp.onActivate hands the college block the press. */
    desk: function (id, deskId, base) {
      said.length = 0;
      return this.CO.deskActivated(deskId, id, base || DESK_BASE);
    },
    /* A K panel's line, as the front plugin sends it on. */
    pick: function (id, words) {
      said.length = 0;
      const parts = ('/pick ' + words).split(/\s+/);
      const lines = [];
      C.command('/pick', parts, id, Number(mp.get(id, 'profileId')) || 0, function (p, m) { lines.push(m); });
      return lines;
    }
  };
}

const store = {};
function place(id, cell, pos) {
  store[id] = store[id] || {};
  store[id].worldOrCellDesc = JSON.stringify(cell);
  store[id].pos = JSON.stringify(pos || [0, 0, 0]);
}
function person(srv, id, pid, prof, halfOrSchools, change) {
  store[id] = store[id] || {};
  store[id].profileId = JSON.stringify(pid);
  store[id].appearance = JSON.stringify({ name: 'P' + pid });
  place(id, 'whiterun:Skyrim.esm');
  let s = srv.P.fresh();
  if (prof) { const r = srv.P.pickProfession(s, prof, halfOrSchools); if (r.ok) { s = r.state; } }
  if (change) { change(s); }
  srv.C.writeState(id, s);
  return id;
}
// The study desks the content plugin stands, one in each hall, and one
// stood anywhere else, which a desk never is.
const DESKS = { arcanaeum: '18150:Thornswood-Content.esp', attainment: '18151:Thornswood-Content.esp',
                countenance: '18152:Thornswood-Content.esp', elements: '18153:Thornswood-Content.esp',
                stray: '18154:Thornswood-Content.esp' };
[['arcanaeum', '13810:Skyrim.esm'], ['attainment', 'cab91:Skyrim.esm'], ['countenance', '1380f:Skyrim.esm'],
 ['elements', '1380e:Skyrim.esm'], ['stray', TAMRIEL]].forEach(function (d) {
  store[idOf(DESKS[d[0]])] = { worldOrCellDesc: JSON.stringify(d[1]), pos: JSON.stringify([0, 0, 0]) };
});
const deskId = function (k) { return idOf(DESKS[k]); };

let srv = server(store);
const P = srv.P;
const L = P.TABLE.limits;
const HOUR = 3600000;
const page = { magic: doc('magic.md'), potions: doc('potions.md'), appr: doc('apprenticeship.md'),
               conj: doc('professions/mage/conjuration.md'), temp: doc('temperature.md') };

// ------------------------------------------------------- A. the numbers --
yes('A: the numbers are the pages\': a mage 2, a taught outsider 1, a semester 24 hours, 2 spells at most',
    L.collegeSemester === 2 && L.outsiderSemester === 1 && L.semesterHours === 24 && L.outsiderSpells === 2 &&
    /A semester is 24 hours of real time/.test(page.magic) && /A mage receives 2 spell points/.test(page.magic) &&
    /A person a master has taught receives 1/.test(page.magic) && /hold 2 spells at most/.test(page.magic));
yes('A: the four halls are the cells doors.json names, and the desk is the content plugin\'s activator',
    doors.cells['1380e:Skyrim.esm'].name === 'Hall of the Elements' && doors.cells['1380f:Skyrim.esm'].name === 'Hall of Countenance' &&
    doors.cells['cab91:Skyrim.esm'].name === 'Hall of Attainment' && doors.cells['13810:Skyrim.esm'].name === 'The Arcanaeum' &&
    Object.keys(srv.CO.HALLS).length === 4 && Object.keys(srv.CO.HALLS).every(function (c) { return !!doors.cells[c]; }) &&
    srv.CO.DESK_BASE === DESK_BASE);

// ------------------------------------------------------- B. the rules --
{
  const mage = P.pickProfession(P.fresh(), 'mage', ['destruction', 'restoration']).state;
  const t0 = 1800000000000;
  const a = P.study(mage, t0);
  yes('B1: a mage studies and receives 2 spell points', a.ok && a.gained === 2 && P.spellPoints(a.state) === 4 && a.state.studied === t0);
  const b = P.study(JSON.parse(JSON.stringify(a.state)), t0 + 23 * HOUR + 59 * 60000);
  yes('B1: and not again inside 24 hours, as the character is stored, and the line says when (' + b.why + ')',
      !b.ok && /next one opens in 1 minute/.test(b.why) && b.wait === 60000);
  const c = P.study(a.state, t0 + 24 * HOUR);
  yes('B1: at 24 hours the next semester opens: 2 more', c.ok && P.spellPoints(c.state) === 6 && P.semesterOpens(c.state) === t0 + 48 * HOUR);
  const smith = P.pickProfession(P.fresh(), 'smith', 'edgewright').state;
  yes('B2: somebody magic is not open to studies nothing', !P.study(smith, t0).ok && /magic is not yours/.test(P.study(smith, t0).why));
  const master = P.pickProfession(P.fresh(), 'mage', ['destruction', 'illusion']).state;
  master.ranks.destruction = 'master';
  const taught = P.teach(smith, master, 'destruction').state;
  yes('B3: somebody a Master mage taught has their 2 places and no point until a semester', P.placesLeft(taught) === 2 && P.spellPoints(taught) === 0);
  const flames = { name: 'Flames', school: 'destruction', rank: 'novice' };
  const r0 = P.learnFromTome(taught, flames);
  yes('B3: so a novice tome waits for the College, and says so (' + (r0.missing || []).map(function (m) { return m.why; }).join('; ') + ')',
      !r0.ok && r0.missing && r0.missing.length === 1 && r0.missing[0].what === 'points' && /semester at the College/.test(r0.missing[0].why));
  const s1 = P.study(taught, t0);
  yes('B3: a semester hands them 1 point', s1.ok && s1.gained === 1 && s1.school === 'destruction' && P.spellPoints(s1.state) === 1);
  const r1 = P.learnFromTome(s1.state, flames);
  yes('B3: and the tome teaches them Flames, which spends it', r1.ok && P.spellPoints(r1.state) === 0 && r1.state.spells.points === 0);
  const fireball = P.learnFromTome(P.study(r1.state, t0 + 24 * HOUR).state, { name: 'Fireball', school: 'destruction', rank: 'advanced' });
  yes('B3: the point never buys more than Novice: Fireball names the rank', !fireball.ok && fireball.missing.some(function (m) { return m.what === 'level'; }));
  const s2 = P.study(r1.state, t0 + 24 * HOUR);
  const r2 = P.learnFromTome(s2.state, { name: 'Sparks', school: 'destruction', rank: 'novice' });
  const s3 = P.study(r2.state, t0 + 48 * HOUR);
  const r3 = P.learnFromTome(s3.state, { name: 'Frostbite', school: 'destruction', rank: 'novice' });
  yes('B3: two spells, and a third semester\'s point does not lift the cap of 2 (' + (r3.missing || []).map(function (m) { return m.why; }).join('; ') + ')',
      r2.ok && s3.ok && s3.state.spells.points === 1 && P.spellPoints(s3.state) === 0 &&
      !r3.ok && /holds 2 spells at most/.test(r3.missing[0].why) && r3.state === undefined);
  yes('B3: no second spell list: the book is spells.known, and points are spells.points',
      JSON.stringify(Object.keys(r2.state.spells).sort()) === '["known","points"]' && r2.state.spells.known.join() === 'Flames,Sparks');
  // Only the book is granted.
  const off = P.learnFromTome(a.state, { name: 'Thunderclap', school: 'destruction', rank: 'novice' });
  yes('B4: a tome of a spell the book does not list is refused, whatever its school and rank, and nothing is spent',
      !off.ok && off.offBook && off.why === P.OFF_BOOK && !off.missing);
  const old = JSON.parse(JSON.stringify(mage));
  old.spells = { points: 0, known: ['Flames', 'Thunderclap'], tomes: { Thunderclap: { school: 'destruction', rank: 'novice' } } };
  const fb = P.pickSpell(Object.assign({}, old, { ranks: { destruction: 'advanced', restoration: 'novice' }, spells: { points: 1, known: ['Thunderclap'], tomes: { Thunderclap: { school: 'destruction', rank: 'novice' } } } }), 'Firebolt', true);
  yes('B4: a spell outside the book no longer counts as the rank below', !fb.ok && /novice spell of destruction first/.test(fb.why));
  const cl = P.bookClean(old);
  yes('B4: bookClean takes a spell a tome taught before the rule out of the book and gives the mage the point back',
      cl.removed.join() === 'Thunderclap' && cl.state.spells.known.join() === 'Flames' && cl.state.spells.points === 1 && !cl.state.spells.tomes);
  const oldT = JSON.parse(JSON.stringify(s1.state));
  oldT.spells.known = ['Thunderclap'];
  const clT = P.bookClean(oldT);
  yes('B4: somebody a Master taught has the place back and no point made out of nothing',
      clT.removed.join() === 'Thunderclap' && clT.state.spells.known.length === 0 && clT.state.spells.points === oldT.spells.points);
}

// ------------------------------------------------ C. a semester, in the world --
const MAGE = 0xff000101, SMITH = 0xff000102, OUT = 0xff000103, NPC = 0xff000104, CASTER = 0xff000105, BODY = 0xff000106;
person(srv, MAGE, 11, 'mage', ['destruction', 'restoration']);
person(srv, SMITH, 12, 'smith', 'edgewright');
person(srv, OUT, 13, 'smith', 'platewright', function (s) {
  const m = P.pickProfession(P.fresh(), 'mage', ['restoration', 'illusion']).state;
  m.ranks.restoration = 'master';
  const t = P.teach(s, m, 'restoration').state;
  Object.keys(t).forEach(function (k) { s[k] = t[k]; });
});
{
  let lines = srv.pick(MAGE, 'study');
  const st0 = srv.C.stateOf(MAGE);
  yes('C1: the old K panel\'s Study is refused, and says where the desks are (' + lines.join(' ') + ')',
      /^No: a semester is taken at a study desk in one of the College's halls: press E at the desk\.$/.test(lines[0]) &&
      P.spellPoints(st0) === 2 && !st0.studied && st0.note && st0.note.about === 'study');
  yes('C1: any other press is none of the College\'s business', srv.desk(MAGE, deskId('arcanaeum'), '18030:Thornswood-Content.esp') === null &&
      P.spellPoints(srv.C.stateOf(MAGE)) === 2);
  let line = srv.desk(MAGE, deskId('stray'));
  yes('C1: a desk outside the halls hands out nothing (' + line + ')',
      line === 'No: this desk is not in one of the College\'s halls.' && P.spellPoints(srv.C.stateOf(MAGE)) === 2);
  line = srv.desk(MAGE, deskId('arcanaeum'));
  const st1 = srv.C.stateOf(MAGE);
  yes('C1: at the Arcanaeum\'s desk a mage receives 2 spell points, wherever they were said to stand (' + line + ')',
      P.spellPoints(st1) === 4 && st1.studied === srv.now() && !st1.note &&
      /^A semester at the College, in the Arcanaeum: 2 spell points\. You have 4 to spend\. The next semester opens in 24 hours\.$/.test(line));
  yes('C1: and the K panel is told when the next one opens, and which halls have a desk', st1.panel && st1.panel.college &&
      st1.panel.college.gain === 2 && st1.panel.college.school === null && st1.panel.college.opens === srv.now() + 24 * HOUR &&
      st1.panel.college.halls.join() === 'the Hall of the Elements,the Hall of Countenance,the Hall of Attainment,the Arcanaeum' &&
      !st1.panel.college.rooms);
  srv.at(srv.now() + 5 * HOUR);
  line = srv.desk(MAGE, deskId('countenance'));
  yes('C2: a desk again five hours later is refused, at any desk (' + line + ')',
      /^No: .*next one opens in 19 hours\.$/.test(line) && P.spellPoints(srv.C.stateOf(MAGE)) === 4);
  // A restart: a new server over the same store.
  srv = server(store, { clock: srv.now() + 4 * HOUR });
  line = srv.desk(MAGE, deskId('elements'));
  yes('C2: after a restart the clock still holds (' + line + ')', /next one opens in 15 hours/.test(line) && P.spellPoints(srv.C.stateOf(MAGE)) === 4);
  srv.at(srv.now() + 15 * HOUR);
  line = srv.desk(MAGE, deskId('elements'));
  yes('C2: and once 24 hours have passed, the Hall of the Elements\' desk gives the next 2', /in the Hall of the Elements: 2 spell points/.test(line) &&
      P.spellPoints(srv.C.stateOf(MAGE)) === 6);
  line = srv.desk(OUT, deskId('attainment'));
  const so = srv.C.stateOf(OUT);
  yes('C3: at the Hall of Attainment\'s desk somebody a Master taught receives 1, for a Novice spell of their school (' + line + ')',
      /in the Hall of Attainment: 1 spell point, for a Novice spell of Restoration from its tome\. You have 1 to spend\./.test(line) &&
      P.spellPoints(so) === 1 && so.panel.college.gain === 1 && so.panel.college.school === 'restoration');
  line = srv.desk(SMITH, deskId('countenance'));
  yes('C3: somebody magic is not open to is told so at the desk, and gets no College page', /magic is not yours yet/.test(line) && !srv.C.stateOf(SMITH).panel.college);
  yes('C4: nobody is told to type it, and the K panel sends nothing for it: the desk is the semester',
      !/send\('college'/.test(ui) && !/'Study'/.test(ui) && !/'study': 'college'/.test(ui) &&
      /Pick what\? class, profession, spell, staffspell or town\./.test(CHARACTER) && !/\/study/.test(COLLEGE) &&
      !/courtyard/.test(COLLEGE));
}

// --------------------------------------------------- D. only the book --
{
  srv = server(store, { learned: {} });
  person(srv, CASTER, 21, 'mage', ['destruction', 'restoration'], function (s) {
    s.spells = { points: 0, known: ['Flames', 'Thunderclap'], tomes: { Thunderclap: { school: 'destruction', rank: 'novice' } } };
  });
  person(srv, NPC, -1, null);
  store[NPC].profileId = JSON.stringify(-1);
  const ench = 0xff000107;
  person(srv, ench, 22, 'enchanter', 'bladebinder', function (s) { s.staffSpells = [STAFFSP]; });
  srv.learned[CASTER] = [FLAMES, THUNDER, BLESSING, RATTLES, POWER, LUTE];
  srv.learned[ench] = [STAFFSP];
  const gone = srv.CO.cleanAtLogin(CASTER);
  if (process.env.DEBUG) { console.log(gone, srv.learned[CASTER]); }
  const sc = srv.C.stateOf(CASTER);
  yes('D1: at login the engine\'s list loses the off-book spell and keeps the book, a blessing, a disease, a power and the instruments',
      gone.join() === THUNDER && srv.learned[CASTER].join() === [FLAMES, BLESSING, RATTLES, POWER, LUTE].join() &&
      srv.calls.some(function (c) { return c.fn === 'RemoveSpell' && c.args[0].desc === THUNDER; }));
  yes('D1: the name leaves the book, the mage has the point back, and is told (' + srv.told(CASTER).join(' ') + ')',
      sc.spells.known.join() === 'Flames' && sc.spells.points === 1 && !sc.spells.tomes &&
      /^Thunderclap is not in the College's book, so it was taken back\. Only the book's spells are granted here, and the spell points they cost are yours again\.$/.test(srv.told(CASTER)[0]));
  yes('D1: an Enchanter\'s unlocked staff spell is the staff rules\', and stays', srv.CO.cleanAtLogin(ench).length === 0 && srv.learned[ench].join() === STAFFSP);
  yes('D1: grantKnown takes the book clean before it puts the book back on', /college\.cleanAtLogin\(actorId\)[\s\S]*var s = stateOf\(actorId\)/.test(between('  function grantKnown(actorId) {', '\n  }\n')));
  // A menu's spell, put in a hand.
  srv.said.length = 0;
  srv.ctx.mp.onUpdateEquipmentAttempt(CASTER, { inv: { entries: [] }, leftSpell: idOf(MENDING), rightSpell: idOf(FLAMES), numChanges: 3 }, true);
  const take = JSON.parse(store[CASTER][srv.CO.TAKE_PROPERTY]);
  yes('D2: a spell a mod\'s menu put in a hand is taken back, and only that one (' + srv.told(CASTER).join(' ') + ')',
      take.ids.join() === String(idOf(MENDING)) && take.at === srv.now() &&
      /^Mending Touch is not in the College's book, so it is taken back\. Only the book's spells are granted here\.$/.test(srv.told(CASTER)[0]));
  srv.said.length = 0;
  srv.ctx.mp.onUpdateEquipmentAttempt(CASTER, { inv: { entries: [] }, leftSpell: idOf(MENDING), rightSpell: idOf(FLAMES), numChanges: 4 }, true);
  yes('D2: the same two spells again is one comparison and no second order', srv.said.length === 0 && JSON.parse(store[CASTER][srv.CO.TAKE_PROPERTY]).at === take.at);
  srv.ctx.mp.onUpdateEquipmentAttempt(ench, { inv: { entries: [] }, rightSpell: idOf(STAFFSP) }, true);
  srv.ctx.mp.onUpdateEquipmentAttempt(NPC, { inv: { entries: [] }, rightSpell: idOf(THUNDER) }, true);
  yes('D2: a staff spell in an Enchanter\'s hand and an NPC\'s hands are left alone',
      !store[ench][srv.CO.TAKE_PROPERTY] && !store[NPC][srv.CO.TAKE_PROPERTY]);
  yes('D2: the handler answers nothing, so the engine has nothing to refuse', srv.ctx.mp.onUpdateEquipmentAttempt(CASTER, { leftSpell: 0 }, true) === undefined);
  // The client's half: one removal per order, and only once the character is there.
  const removed = [];
  const pc = { hasSpell: function (sp) { return sp.id !== 0; }, removeSpell: function (sp) { removed.push(sp.id); } };
  const SP = { Game: { getPlayer: function () { return pc; }, getFormEx: function (id) { return { id: id }; } },
               Spell: { from: function (f) { return f; } } };
  const ownerCtx = { sp: SP, state: {}, value: take };
  const script = new Function('ctx', srv.made[srv.CO.TAKE_PROPERTY].updateOwner);
  script(ownerCtx); script(ownerCtx);
  yes('D3: the client takes it off once per order, however many frames it runs', removed.join() === String(idOf(MENDING)) &&
      srv.made[srv.CO.TAKE_PROPERTY].isVisibleByOwner && !srv.made[srv.CO.TAKE_PROPERTY].isVisibleByNeighbors);
  srv.CO.cleanAtLogin(CASTER);
  yes('D3: the next login clears the order, so nothing replays', JSON.parse(store[CASTER][srv.CO.TAKE_PROPERTY]).at === 0);
}

// ------------------------------------------- E. no thrall of a person --
{
  srv = server(store);
  person(srv, BODY, 31, 'smith', 'edgewright');
  store[BODY].isDead = JSON.stringify(true);
  const body2 = 0xff000108;
  person(srv, body2, -1, null);
  store[body2].profileId = JSON.stringify(-1);
  const hit = srv.ctx.mp['onPapyrusEvent:OnHit'];
  const me = { type: 'form', desc: descOf(CASTER) };
  yes('E1: Dead Thrall, Raise Zombie, a scroll of Dead Thrall and a staff of reanimation raise the dead; Flames does not',
      srv.CO.reanimates(idOf(THRALL)) && srv.CO.reanimates(idOf(ZOMBIE)) && srv.CO.reanimates(idOf(SCROLL)) &&
      srv.CO.reanimates(idOf(RSTAFF)) && !srv.CO.reanimates(idOf(FLAMES)) && srv.CO.REANIMATE === 22);
  srv.said.length = 0;
  hit(BODY, me, { type: 'espm', desc: THRALL }, null, false, false, false, false);
  const laid = store[BODY][srv.CO.LAYDOWN_PROPERTY] ? JSON.parse(store[BODY][srv.CO.LAYDOWN_PROPERTY]) : null;
  yes('E2: Dead Thrall on a person\'s body is refused by the server: the body is put back down and the caster told (' + srv.told(CASTER).join(' ') + ')',
      laid && laid.at === srv.now() &&
      /^Dead Thrall does not take a person\. Raising somebody's character is a death or a change for good, and it needs everyone's yes out of character first, so the body stays down\.$/.test(srv.told(CASTER)[0]));
  srv.said.length = 0;
  hit(BODY, me, { type: 'espm', desc: SCROLL }, null, false, false, false, false);
  yes('E2: a scroll of it is refused the same way', /^That spell does not take a person/.test(srv.told(CASTER)[0]));
  srv.said.length = 0;
  hit(body2, me, { type: 'espm', desc: THRALL }, null, false, false, false, false);
  hit(BODY, me, { type: 'espm', desc: FLAMES }, null, false, false, false, false);
  yes('E3: a body the world placed is the spell working as written, and Flames on a person is not this rule',
      !store[body2][srv.CO.LAYDOWN_PROPERTY] && srv.said.length === 0 && JSON.parse(store[BODY][srv.CO.LAYDOWN_PROPERTY]).at === laid.at);
  // Every machine that sees the body: down again, once, and only while the server holds it dead.
  const kills = [];
  const local = { dead: false, isDead: function () { return this.dead; }, endDeferredKill: function () { kills.push('end'); },
                  kill: function () { kills.push('kill'); this.dead = true; } };
  const nctx = { value: laid, state: {}, refr: local, sp: { Actor: { from: function (r) { return r; } } },
                 get: function (k) { return k === 'isDead' ? serverDead : undefined; } };
  let serverDead = true;
  const lay = new Function('ctx', srv.made[srv.CO.LAYDOWN_PROPERTY].updateNeighbor);
  lay(nctx); local.dead = false; lay(nctx);
  yes('E4: the raised body goes back down once per order, the way the client\'s own death sync does it',
      kills.join() === 'end,kill' && srv.made[srv.CO.LAYDOWN_PROPERTY].isVisibleByNeighbors && !srv.made[srv.CO.LAYDOWN_PROPERTY].isVisibleByOwner);
  serverDead = false;
  const k2 = [];
  const alive = { isDead: function () { return false; }, endDeferredKill: function () { k2.push('end'); }, kill: function () { k2.push('kill'); } };
  lay({ value: { at: laid.at + 1 }, state: {}, refr: alive, sp: nctx.sp, get: function () { return false; } });
  yes('E4: and never a body the server holds alive', k2.length === 0);
  yes('E5: the OnHit handler hands the hit to the college block on its own, beside the others, and never answers false',
      /college\.hit\(targetId, aggressor, source\)/.test(ONHIT) && !/return false/.test(ONHIT));
  yes('E5: the page and the server agree: the reanimate spells on a person are refused, a world body is the spell',
      /You cannot turn a corpse that is a person's character into a thrall/.test(page.magic) && /A body the world placed is the spell/.test(page.conj));
}

// --------------------------------------------- F. restoration strain --
{
  srv = server(store);
  person(srv, CASTER, 21, 'mage', ['destruction', 'restoration']);
  const t0 = srv.now();
  // The one OnSpellCast handler is the injury block's (#1383); it hands every cast on to this block.
  const cast = function (id, sp) { return srv.CO.cast(id, sp); };
  const heal = { type: 'espm', desc: HEALING };
  const mod = function () { const e = srv.CO.effects(CASTER); return e ? e.RestorationMod : 0; };
  const effectsOnPanel = function () { const s = JSON.parse(store[CASTER].thornswoodCharacter); return (s.panel && s.panel.effects) || {}; };
  const S = srv.CO.STRAIN;
  yes('F0: the numbers are the page\'s: 30 seconds, 25% more each, the fifth refused for 20 seconds, at the weary cold recovery',
      S.window === 30 && S.rise === 0.25 && S.casts === 4 && S.refused === 20 &&
      /Inside 30 seconds, each restoration spell after the first costs 25%\s+more magicka than the last\. The fifth in that window is refused for 20\s+seconds/.test(page.potions) &&
      /weary: \{ staminaRateMult: (-?\d+), speedMult: -2 \}/.exec(src)[1] === String(S.weary) &&
      /\| 20 \| Weary \| about 30 or 70 \| -20% stamina recovery/.test(page.temp));
  cast(CASTER, heal);
  yes('F1: the first restoration spell is the price it was; the next costs 25% more', mod() === -25 && effectsOnPanel().RestorationMod === -25);
  srv.at(t0 + 5000); cast(CASTER, { type: 'espm', desc: HANDS });
  yes('F1: then 25% more than that', mod() === -56.25);
  srv.at(t0 + 9000); cast(CASTER, heal);
  yes('F1: and 25% more again', mod() === -95.31);
  cast(CASTER, { type: 'espm', desc: FLAMES });
  yes('F1: a destruction spell is not restoration and counts for nothing', mod() === -95.31);
  srv.said.length = 0;
  srv.at(t0 + 12000); cast(CASTER, heal);
  const e4 = srv.CO.effects(CASTER);
  yes('F2: after the fourth, the next is refused for 20 seconds, and stamina and health recover at the weary cold numbers (' + srv.told(CASTER).join(' ') + ')',
      e4.RestorationMod === -S.shut && e4.staminaRateMult === -20 && e4.healRateMult === -20 &&
      effectsOnPanel().healRateMult === -20 && /for 20 seconds no restoration spell takes/.test(srv.told(CASTER)[0]));
  srv.at(t0 + 12000 + 19999); srv.tick();
  yes('F2: still refused until the 20 seconds are up', (srv.CO.effects(CASTER) || {}).staminaRateMult === -20);
  srv.at(t0 + 12000 + 20051); srv.tick();
  yes('F2: then it lifts, the window with it, and the panel is written again', srv.CO.effects(CASTER) === null && !effectsOnPanel().RestorationMod && !effectsOnPanel().healRateMult);
  srv.at(t0 + 40000); cast(CASTER, heal);
  srv.at(t0 + 40000 + 30051); srv.tick();
  yes('F3: one cast and 30 quiet seconds: the window closes and the price is back', srv.CO.effects(CASTER) === null && !effectsOnPanel().RestorationMod);
  srv.at(t0 + 100000); cast(CASTER, heal);
  srv.at(t0 + 100000 + 31000); cast(CASTER, heal);
  yes('F3: a cast after the window is a new first one', mod() === -25);
  store[NPC] = { profileId: JSON.stringify(-1) };
  cast(NPC, heal);
  yes('F4: an NPC a client hosts is the world\'s, not strained', !srv.CO.strain[NPC]);
  const castAt = src.indexOf("mp['onPapyrusEvent:OnSpellCast'] = guard(");
  yes('F4: there is one OnSpellCast handler, and it hands every cast to the college block on its own, never answering false',
      (src.match(/mp\['onPapyrusEvent:OnSpellCast'\] =/g) || []).length === 1 &&
      /var college = g\.__thornswoodCollege;\s*if \(college && college\.cast\) \{\s*try \{ college\.cast\(casterId, spell\); \}/.test(src.slice(castAt, castAt + 600)) &&
      !/return false/.test(src.slice(castAt, src.indexOf('\n  });', castAt))));
  yes('F5: the effects reach the client on the map it already applies, on top of the tree, the needs and the maneuvers',
      /view\.effects = withCollege\(actorId, view\.effects\);/.test(CHARACTER));
}

// ------------------------------------------------------------ W. withered --
{
  srv = server(store);
  const WI = 0xff000120, WI2 = 0xff000121;
  person(srv, WI, 61, 'mage', ['destruction', 'restoration']);
  person(srv, WI2, 62, 'mage', ['destruction', 'restoration']);
  const MOST = { health: 100, magicka: 150 };
  const KINDS = { 0x3eadd: 'potion', 0x3a5a4: 'poison', 0x64b3f: 'food', 0x34c5e: 'ale' };
  function plug(s2) {
    // The two blocks withered asks, at call time: the engine's most (the
    // maneuvers block) and what a thing swallowed is (the needs block).
    s2.ctx.__thornswoodManeuvers = { engineMost: function (id, av) { return MOST[av] || 0; } };
    s2.ctx.__thornswoodNeeds = { kindOf: function (b) { return KINDS[b] || ''; } };
  }
  plug(srv);
  const W = srv.CO.WITHERED;
  const t0 = srv.now();
  const MIN = 60000;
  const panel = function (id) { const st = JSON.parse(store[id].thornswoodCharacter); return (st.panel && st.panel.effects) || {}; };
  const before = panel(WI);
  const h0 = before.health || 0, m0 = before.magicka || 0;

  yes('W0: the numbers are the page\'s: five potions or ten restoration casts in an hour, 30 minutes, 80%',
      W.potions === 5 && W.casts === 10 && W.hour === 60 && W.minutes === 30 && W.share === 0.8 &&
      /Five potions in an hour, or ten restoration casts in an hour, sets\s+withered for 30 real minutes\. Max health and max magicka are 80% of\s+what they were\./.test(page.potions));

  for (let i = 0; i < 4; i++) { srv.at(t0 + i * 10 * MIN); srv.CO.drank(WI, 0x3eadd); }
  yes('W1: four potions in an hour are four potions', !srv.CO.isWithered(WI) && !srv.CO.effects(WI));
  srv.said.length = 0;
  srv.at(t0 + 50 * MIN); srv.CO.drank(WI, 0x3eadd);
  const e1 = srv.CO.effects(WI, undefined, { health: h0, magicka: m0 });
  yes('W1: the fifth inside the hour withers them, and they are told (' + srv.told(WI).join(' ') + ')',
      srv.CO.isWithered(WI) && /You are withered: five potions in an hour/.test(srv.told(WI)[0]));
  yes('W1: a fifth of max health and max magicka comes off: the engine\'s most and what the map already adds (' + JSON.stringify(e1) + ')',
      !!e1 && e1.health === -Math.round((MOST.health + h0) * 0.2 * 100) / 100 &&
      e1.magicka === -Math.round((MOST.magicka + m0) * 0.2 * 100) / 100);
  yes('W1: and it is on the panel\'s map, the one the client applies',
      panel(WI).health === h0 + e1.health && panel(WI).magicka === m0 + e1.magicka);
  yes('W1: stamina is not touched', panel(WI).stamina === before.stamina);

  // Over a relog and a restart: a second server over the same store.
  srv.at(t0 + 70 * MIN);
  srv = server(store, { clock: t0 + 70 * MIN });
  plug(srv);
  yes('W2: a restart does not end it: the end is on the character', srv.CO.isWithered(WI));
  srv.C.arrival(WI);
  yes('W2: arriving again, the map still carries it', panel(WI).health === h0 + e1.health);
  srv.at(t0 + 50 * MIN + 30 * MIN - 1); srv.tick();
  yes('W2: still withered a moment before the 30 minutes are up', srv.CO.isWithered(WI));
  srv.said.length = 0;
  srv.at(t0 + 50 * MIN + 30 * MIN + 60); srv.tick();
  yes('W2: then it passes on its own, armed at arrival, and the map is written again without it (' + srv.told(WI).join(' ') + ')',
      !srv.CO.isWithered(WI) && !srv.CO.effects(WI) && (panel(WI).health || 0) === h0 &&
      /The withering has passed/.test(srv.told(WI)[0]));

  // Five potions over more than an hour are not five in an hour.
  const t1 = srv.now() + MIN;
  for (let i = 0; i < 5; i++) { srv.at(t1 + i * 15 * MIN); srv.CO.drank(WI2, 0x3eadd); }
  yes('W3: five potions an hour and more apart do not wither', !srv.CO.isWithered(WI2));
  const t2 = srv.now() + 2 * 60 * MIN;
  srv.at(t2);
  [0x64b3f, 0x34c5e, 0x3a5a4, 0x64b3f, 0x34c5e, 0x3a5a4].forEach(function (b) { srv.CO.drank(WI2, b); });
  yes('W3: food, ale and a poison are not potions', !srv.CO.isWithered(WI2));
  for (let i = 0; i < 5; i++) { srv.CO.drank(WI2, 0xff00a001 + i); }
  yes('W3: a potion somebody brewed, a form only their game has, is a potion', srv.CO.isWithered(WI2));
  store[NPC] = { profileId: JSON.stringify(-1) };
  for (let i = 0; i < 6; i++) { srv.CO.drank(NPC, 0x3eadd); }
  yes('W3: an NPC a client hosts is the world\'s, not withered', !srv.CO.isWithered(NPC));

  // Ten restoration casts in an hour, with the strain's windows between them.
  srv = server(store, { clock: t2 + 3 * 60 * MIN });
  plug(srv);
  const WI3 = 0xff000122;
  person(srv, WI3, 63, 'mage', ['destruction', 'restoration']);
  const t3 = srv.now();
  for (let i = 0; i < 9; i++) { srv.at(t3 + i * 5 * MIN); srv.CO.cast(WI3, { type: 'espm', desc: HEALING }); srv.CO.cast(WI3, { type: 'espm', desc: FLAMES }); }
  yes('W4: nine restoration casts in an hour, and destruction between them, are not withered', !srv.CO.isWithered(WI3));
  srv.said.length = 0;
  srv.at(t3 + 50 * MIN); srv.CO.cast(WI3, { type: 'espm', desc: HANDS });
  yes('W4: the tenth withers them (' + srv.told(WI3).join(' ') + ')',
      srv.CO.isWithered(WI3) && /ten restoration spells in an hour/.test(srv.told(WI3).join(' ')));

  // The wiring.
  const eatAt = src.indexOf("mp.onEatItem = guard('onEatItem'");
  const eat = src.slice(eatAt, src.indexOf('\n  });', eatAt));
  yes('W5: there is one onEatItem handler, and it hands every drink to the college block on its own, never answering false',
      (src.match(/mp\.onEatItem =/g) || []).length === 1 &&
      /var college = g\.__thornswoodCollege;\s*if \(college && college\.drank\) \{\s*try \{ college\.drank\(actorId, Number\(baseId\) \|\| 0\); \}/.test(eat) &&
      !/return false/.test(eat));
  yes('W5: the needs block says what a thing swallowed is, and the maneuvers block what the engine\'s most is',
      /kindOf: foodKind/.test(src) && /engineMost: engineMost/.test(src) &&
      /health: \{ race: 36, npc: 20, floorAtZero: true \}/.test(src) && /magicka: \{ race: 40, npc: 4, floorAtZero: false \}/.test(src) &&
      /stamina: \{ race: 44, npc: 6, floorAtZero: true \}/.test(src));
  yes('W5: the college gets the map so far, so withered is a share of it',
      /var add = co\.effects\(actorId, undefined, base\);/.test(CHARACTER));
  yes('W6: the page says withered is in the server, and that the cooked meal clear waits for food',
      /Withered is in the server/.test(page.potions) && /#1382|cooked meal/.test(page.potions.slice(page.potions.indexOf('## Where this is'))));
}

// ------------------------------------------------------------ G. the pages --
{
  const where = function (p) { return p.slice(p.indexOf('## Where this is')); };
  yes('G: magic.md says the semester, at the study desks, the take back and the refusal are in the server', /at the study desks/.test(where(page.magic)) && !/courtyard/.test(page.magic) && !/neither is applied/.test(page.magic) && !/does not take it back yet/.test(page.magic));
  yes('G: conjuration.md says the server refuses it now', !/Nothing in the server yet\s+refuses Dead Thrall/.test(page.conj));
  yes('G: apprenticeship.md no longer says the semester is missing', !/`\/study` is not\./.test(page.appr));
  yes('G: and no page tells anybody to type /study', !/`\/study`/.test(page.magic + page.appr));
}

// ------------------------------------------------- H. the K panel's College --
{
  srv = server(store);
  const MAGE2 = 0xff000111, SMITH2 = 0xff000112, OUT2 = 0xff000113;
  person(srv, MAGE2, 41, 'mage', ['destruction', 'restoration']);
  person(srv, SMITH2, 42, 'smith', 'edgewright');
  person(srv, OUT2, 43, 'smith', 'platewright', function (s) {
    const m = P.pickProfession(P.fresh(), 'mage', ['illusion', 'restoration']).state;
    m.ranks.illusion = 'master';
    const t = P.teach(s, m, 'illusion').state;
    Object.keys(t).forEach(function (k) { s[k] = t[k]; });
  });
  const sent = [];
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
  const win = { innerWidth: 1920, innerHeight: 1080, addEventListener: function () { },
                skyrimPlatform: { sendMessage: function (to, m) { sent.push(m); } } };
  const box = { window: win, document: docu, setTimeout: function () { }, Date: Date, JSON: JSON, console: console };
  vm.createContext(box);
  let ran = true;
  try { vm.runInContext(ui, box, { filename: 'thornswood-skills.js' }); } catch (e) { ran = false; console.log(e); }
  const api = win.thornswoodSkills;
  yes('H: the K panel runs in a stand-in document', ran && !!api);
  if (api) {
    const root = docu.body.children[0];
    const nav = root._q['.nav'], body = root._q['.body'], confirmBtn = root._q['[data-act="confirm"]'];
    const status = root._q['.status'];
    const navNames = function () {
      return nav.children.filter(function (r) { return /navrow/.test(r.className); }).map(function (r) { return r.children[0].textContent; });
    };
    const panelOf = function (id) { return srv.C.forPanel(srv.C.stateOf(id), false, id); };
    api.open();
    api.setData(null, { panel: panelOf(SMITH2) });
    yes('H1: somebody magic is not open to has no College page (' + navNames().join(', ') + ')', navNames().indexOf('College') === -1);
    api.setData(null, { panel: panelOf(OUT2) });
    yes('H1: somebody a Master mage taught has one, after Profession (' + navNames().join(', ') + ')', navNames()[1] === 'College');
    api.setData(null, { panel: panelOf(MAGE2) });
    yes('H1: a mage has one right after the spell book (' + navNames().join(', ') + ')',
        navNames().indexOf('College') === navNames().indexOf('Spell book') + 1);
    const row = nav.children.filter(function (r) { return /navrow/.test(r.className) && r.children[0].textContent === 'College'; })[0];
    yes('H1: and it says a semester is open', /a semester is open/.test(row.textContent));
    row.onclick();
    yes('H2: the page says what a semester hands this mage, where, and that one is open (' + body.textContent + ')',
        /A semester is 24 hours\. Each one hands you 2 spell points, for the spell book\./.test(body.textContent) &&
        /A study desk stands in the Hall of the Elements, the Hall of Countenance, the Hall of Attainment and the Arcanaeum\. Press E at one to study\./.test(body.textContent) &&
        /A semester is open to you now\./.test(body.textContent));
    yes('H2: the page has no button, and its line says to press E at a desk (' + status.textContent + ')',
        confirmBtn.style.display === 'none' &&
        status.textContent === 'Press E at a study desk in one of the College\'s halls. The College answers in the chat.');
    sent.length = 0;
    srv.desk(MAGE2, deskId('attainment'));
    api.setData(null, { panel: panelOf(MAGE2) });
    const row2 = nav.children.filter(function (r) { return /navrow/.test(r.className) && r.children[0].textContent === 'College'; })[0];
    yes('H3: after a desk, the page says when the next semester opens, and nothing was sent (' + body.textContent + ')',
        /Your next semester opens (today|tomorrow|\d+ [A-Z][a-z]+) at \d\d:\d\d\./.test(body.textContent) &&
        !/A semester is open to you now/.test(body.textContent) && !!row2 && /next /.test(row2.textContent) && sent.length === 0);
  }
}

done();
