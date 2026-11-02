// test-1149-pick-spell-tome.js
//
// #1149. The rulebook (#391) says somebody who is not a Mage "needs the
// spellbook AND a Master Mage willing to apprentice them", and magic.md and
// apprenticeship.md say they learn "from the tome". Reading a tome asks the
// Mage rules (#1026). But /pick spell, the line the K panel's spell book
// sends, took the same spell for somebody a Master mage taught with no tome
// at all: pickSpell checked their school, a place and the rank, and never
// asked for the book. The panel draws the spell book for a mage only, but
// the line typed by hand worked for anybody.
//
// This runs the real blocks out of game/gamemode.js in one sandbox over a fake
// mp that keeps properties as JSON the way the server does: the rules, the
// character store and its /pick, the spell tomes block and the staff spells
// block with the one mp.onReadBook, and a fake record for the Flames tome.
// It proves:
//   A. a taught Smith with a semester's point: /pick spell Flames is refused,
//      the line says to read the tome of Flames, nothing is learned and the
//      point is not spent
//   B. the same Smith reads the Flames tome and learns it
//   C. the rules answer the same, and a mage still picks off the book
//   D. somebody nobody taught still hears that magic is not theirs
//
// Read only.
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
function between(a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j + b.length) : null;
}

const RULES = between('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between('// ==== thornswood character ====', '// ==== end thornswood character ====');
const TOMES = between('// ==== thornswood spell tomes ====', '// ==== end thornswood spell tomes ====');
const STAFF = between('// ==== thornswood staff spells ====', '// ==== end thornswood staff spells ====');
const SPELL_ON = between('function spellOn(actorId, spellDesc, on) {', '\n}\n');
yes('the rules, the character store, the spell tomes, the staff spells and spellOn are in the gamemode',
    !!(RULES && CHARACTER && TOMES && STAFF && SPELL_ON));
if (!(RULES && CHARACTER && TOMES && STAFF && SPELL_ON)) { done(); }

// ------------------------------------------------------------ the records --
const IDS = {};
const DESCS = {};
let nextId = 0x100;
function idOf(desc) {
  if (!Object.prototype.hasOwnProperty.call(IDS, desc)) { IDS[desc] = ++nextId; DESCS[nextId] = desc; }
  return IDS[desc];
}
function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
const RECORDS = {};
/** A BOOK whose DATA says it teaches spellDesc (flag 0x04, the spell at offset 4). */
function tome(tomeDesc, spellDesc) {
  RECORDS[idOf(tomeDesc)] = { type: 'BOOK', editorId: 'SpellTome', flags: 0, id: idOf(tomeDesc), fields: [
    { type: 'DATA', data: [4, 0, 0, 0].concat(u32(idOf(spellDesc)), u32(750), [0, 0, 128, 63]) }
  ] };
}
tome('t-flames:Skyrim.esm', '12fcd:Skyrim.esm');   // Flames, Novice Destruction, as SPELL_IDS has it
tome('t-sparks:Skyrim.esm', '2dd2a:Skyrim.esm');   // Sparks, Novice Destruction

// -------------------------------------------------------------- the server --
const store = {};
const said = [];
const learned = {};   // actor desc -> [spell desc] the engine holds
function actorDesc(id) { return 'actor' + Number(id).toString(16) + ':Runtime'; }
const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return []; }
    const p = store[id] || {};
    return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
  },
  set: function (id, key, value) { (store[id] = store[id] || {})[key] = JSON.stringify(value); },
  getIdFromDesc: function (d) { return idOf(d); },
  getDescFromId: function (id) { return DESCS[id] || actorDesc(id); },
  lookupEspmRecordById: function (id) {
    const r = RECORDS[id];
    return r ? { record: r, toGlobalRecordId: function (local) { return local; } } : null;
  },
  callPapyrusFunction: function (kind, cls, fn, self, args) {
    const who = self ? self.desc : '';
    const list = learned[who] || [];
    if (fn === 'GetSpellCount') { return list.length; }
    if (fn === 'GetNthSpell') { return list[args[0]] ? { type: 'espm', desc: list[args[0]] } : null; }
    if (fn === 'RemoveSpell') { const at = list.indexOf(args[0].desc); if (at !== -1) { list.splice(at, 1); } return true; }
    if (fn === 'AddSpell') { if (list.indexOf(args[0].desc) === -1) { list.push(args[0].desc); } learned[who] = list; return true; }
    return undefined;
  }
};
const ctx = {
  mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
  isFinite: isFinite, parseInt: parseInt, Infinity: Infinity,
  console: { log: function () { }, error: function () { } },
  guard: function (name, fn) { return fn; },
  setInterval: function () { return 1; }, clearInterval: function () { },
  setTimeout: function () { return 1; },
  notify: function () { },
  say: function (id, m) { said.push({ id: id, text: m }); },
  log: function () { },
  giveTool: function () { return null; },
  INSTRUMENT_SPELL: '9456:PlayFluteLuteDrum.esp'
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(SPELL_ON, ctx, { filename: 'spellOn' });
vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
vm.runInContext('function aWord(name) { return "a " + name; }', ctx);
vm.runInContext(TOMES, ctx, { filename: 'gamemode.js spell tomes' });
vm.runInContext(STAFF, ctx, { filename: 'gamemode.js staff spells' });
const C = ctx.__thornswoodCharacter;
const P = ctx.__thornswoodProgression;
yes('the rules and the character store registered', !!C && !!C.command && !!P && !!P.pickSpell);

/* The K panel's line, as the front plugin sends it: '/pick spell Flames'. */
function pick(id, words) {
  const parts = ('/pick ' + words).split(/\s+/);
  const lines = [];
  C.command('/pick', parts, id, Number(mp.get(id, 'profileId')) || 0, function (p, m) { lines.push(m); });
  return lines.join(' ');
}
function read(id, desc) { said.length = 0; return mp.onReadBook(id, idOf(desc)); }
function readLine(id) { return said.filter(function (x) { return x.id === id; }).map(function (x) { return x.text; }).join(' '); }
function person(id, pid, change) {
  store[id] = store[id] || {};
  store[id].profileId = JSON.stringify(pid);
  store[id].appearance = JSON.stringify({ name: 'P' + pid });
  let s = P.pickClass(P.fresh(), 'miner').state;
  change(s);
  C.writeState(id, s);
  return id;
}
function book(id) { const s = C.stateOf(id); return (s.spells && s.spells.known) || []; }
function points(id) { const s = C.stateOf(id); return Number(s.spells && s.spells.points) || 0; }
function clean(line) { return line.indexOf(String.fromCharCode(0x2014)) === -1 && !/\bplayers?\b/i.test(line); }
const master = { prof: 'mage', ranks: { destruction: 'master' } };
const t0 = 1800000000000;

// ------------------------------------- A. a taught Smith types the panel's line --
const SMITH = 0xff000101;
person(SMITH, 101, function (s) {
  const sm = P.pickProfession(s, 'smith', 'edgewright').state;
  const taught = P.teach(sm, master, 'destruction').state;
  const studied = P.study(taught, t0).state;
  Object.keys(studied).forEach(function (k) { s[k] = studied[k]; });
});
yes('A a Smith a Master mage taught Destruction, after a semester, has a point and 2 places',
    points(SMITH) === 1 && P.spellPoints(C.stateOf(SMITH)) === 1 && P.placesLeft(C.stateOf(SMITH)) === 2);
const no = pick(SMITH, 'spell Flames');
yes('A ISSUE: /pick spell Flames is refused, and the line says to read the tome of Flames (' + no + ')',
    /^No: read the tome of Flames to learn it/.test(no) && /only a Mage picks them on K\.$/.test(no));
yes('A  nothing is learned, the point is not spent, both places are still there',
    book(SMITH).length === 0 && points(SMITH) === 1 && P.placesLeft(C.stateOf(SMITH)) === 2);
yes('A  and the engine was handed no spell', (learned[actorDesc(SMITH)] || []).length === 0);
const note = C.stateOf(SMITH).note || {};
yes('A  the panel hears the same refusal, for its spell pick', note.about === 'spell' && /read the tome of Flames/.test(note.text || ''));
yes('A  the line tells nobody to type anything, with no em dash and no word player', no.indexOf('/') === -1 && clean(no));
const caseNo = pick(SMITH, 'spell flames');
yes('A  typed in another case it is the same refusal', /^No: read the tome of Flames/.test(caseNo) && book(SMITH).length === 0);

// ------------------------------------------------ B. the tome is the door --
const back = read(SMITH, 't-flames:Skyrim.esm');
const line = readLine(SMITH);
yes('B the same Smith reads the Flames tome: not refused, so the engine teaches it and spends the tome (' + line + ')',
    back === undefined && /The tome teaches you Flames, Novice Destruction\. It cost a spell point\./.test(line));
yes('B  Flames is in their book, the point is spent and one place is left',
    book(SMITH).indexOf('Flames') !== -1 && points(SMITH) === 0 && P.placesLeft(C.stateOf(SMITH)) === 1);
// The second place, after the next semester: the panel's line still refuses, the tome teaches.
C.writeState(SMITH, P.study(C.stateOf(SMITH), t0 + 24 * 3600000).state);
const no2 = pick(SMITH, 'spell Sparks');
yes('B  after the next semester, /pick spell Sparks is refused the same way (' + no2 + ')',
    /^No: read the tome of Sparks to learn it/.test(no2) && book(SMITH).indexOf('Sparks') === -1 && points(SMITH) === 1);
yes('B  and the Sparks tome teaches it', read(SMITH, 't-sparks:Skyrim.esm') === undefined && book(SMITH).indexOf('Sparks') !== -1);

// ------------------------------------------------------- C. the rules alone --
{
  const sm = P.pickProfession(P.pickClass(P.fresh(), 'miner').state, 'smith', 'edgewright').state;
  const taught = P.study(P.teach(sm, master, 'destruction').state, t0).state;
  const r = P.pickSpell(taught, 'Flames');
  yes('C pickSpell refuses somebody a Master mage taught, with the tome to read (' + r.why + ')',
      r.ok === false && /read the tome of Flames/.test(r.why || ''));
  yes('C  holding the tome makes no difference: the panel line is a Mage\'s',
      P.pickSpell(taught, 'Flames', true).ok === false);
  const learnt = P.learnFromTome(taught, P.spellAt('Flames'));
  yes('C  learnFromTome teaches the same state Flames', learnt.ok === true && learnt.state.spells.known.indexOf('Flames') !== -1);

  const mage = P.pickProfession(P.pickClass(P.fresh(), 'miner').state, 'mage', ['destruction', 'restoration']).state;
  const m = P.pickSpell(mage, 'Flames');
  yes('C a mage still picks Flames off the book, for a point', m.ok === true && m.state.spells.known.indexOf('Flames') !== -1 &&
      m.state.spells.points === mage.spells.points - 1);
  const MAGE = 0xff000102;
  person(MAGE, 102, function (s) {
    const x = P.pickProfession(s, 'mage', ['destruction', 'restoration']).state;
    Object.keys(x).forEach(function (k) { s[k] = x[k]; });
  });
  const got = pick(MAGE, 'spell Flames');
  yes('C  and through the panel\'s line: You learn Flames (' + got + ')', /You learn Flames\./.test(got) &&
      book(MAGE).indexOf('Flames') !== -1 && (learned[actorDesc(MAGE)] || []).indexOf('12fcd:Skyrim.esm') !== -1);
}

// --------------------------------------------- D. nobody has taught them --
{
  const NOBODY = 0xff000103;
  person(NOBODY, 103, function (s) {
    const x = P.pickProfession(s, 'smith', 'edgewright').state;
    Object.keys(x).forEach(function (k) { s[k] = x[k]; });
  });
  const n = pick(NOBODY, 'spell Flames');
  yes('D a Smith nobody taught still hears that a Master mage has to take them on first (' + n + ')',
      /magic is not yours yet: a Master mage has to take you on first/.test(n) && book(NOBODY).length === 0);
}

done();
