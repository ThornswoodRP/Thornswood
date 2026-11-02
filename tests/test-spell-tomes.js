// test-spell-tomes.js
//
// Issue #1026. Reading a spell tome taught its spell to anybody, whatever the
// Mage rules said: the engine teaches any book with the teaches-spell flag
// unless mp.onReadBook answers false. Patrick, 29 September: "No they still
// need the spell points, the level, and a spell from the level below."
//
// This runs the real blocks out of game/gamemode.js in a sandbox with a fake
// mp that answers lookupEspmRecordById out of a handful of made-up records in
// the engine's shape (type, editorId, fields of raw bytes, toGlobalRecordId):
//   the rules (thornswood progression), the character store (thornswood
//   character), THE SPELL TOMES block, and THE STAFF SPELLS block with the
//   one mp.onReadBook.
// and proves:
//   A. a book that teaches no spell reads as Skyrim reads it: nothing said
//   B. each of the three refusals on its own, and all three at once, keeps
//      the tome (onReadBook answers false), learns nothing, spends nothing,
//      and the chat line names exactly the ones missing
//   C. a tome that passes teaches: the spell is in the book, a point is spent,
//      the handler lets the engine teach it, and the line says so
//   D. somebody a Master mage taught spends a semester's point (#1387) and a
//      place under the cap, and is refused once the cap is reached, saying why
//   E. a spell the rulebook does not list is refused (#1387: only the book is
//      granted), whatever school and rank the game's records give it: the
//      half cost perk first, the effects second; a spell with neither is
//      refused and logged
//   F. a spell already in the book is not charged for again
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
function between(a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j) : null;
}

const RULES = between('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between('// ==== thornswood character ====', '// ==== end thornswood character ====');
const TOMES = between('// ==== thornswood spell tomes ====', '// ==== end thornswood spell tomes ====');
const STAFF = between('// ==== thornswood staff spells ====', '// ==== end thornswood staff spells ====');
yes('the rules, the character store, the spell tomes block and the staff spells block are in the gamemode',
    RULES !== null && CHARACTER !== null && TOMES !== null && STAFF !== null);
if (RULES === null || CHARACTER === null || TOMES === null || STAFF === null) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// ------------------------------------------------------------ the records --

const IDS = {};
const DESCS = {};
let nextId = 0x100;
function idFor(desc) {
  if (!Object.prototype.hasOwnProperty.call(IDS, desc)) { IDS[desc] = ++nextId; DESCS[nextId] = desc; }
  return IDS[desc];
}
function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
function i32(n) { return u32(n >>> 0); }
function zeros(n) { const a = []; for (let i = 0; i < n; i++) { a.push(0); } return a; }
const RECORDS = {};
function record(desc, type, editorId, fields) {
  RECORDS[idFor(desc)] = { type: type, editorId: editorId, flags: 0, id: idFor(desc), fields: fields };
}
/** A BOOK whose DATA says it teaches spellDesc (flag 0x04, the spell at offset 4). */
function tome(tomeDesc, spellDesc) {
  record(tomeDesc, 'BOOK', 'SpellTome', [
    { type: 'DATA', data: [4, 0, 0, 0].concat(u32(idFor(spellDesc)), u32(750), [0, 0, 128, 63]) }
  ]);
}
/** A SPEL with SPIT naming a half cost perk (offset 32) and EFID effects. */
function spell(desc, name, perkDesc, effectDescs) {
  const spit = zeros(32).concat(u32(perkDesc ? idFor(perkDesc) : 0));
  const fields = [{ type: 'FULL', data: Array.from(Buffer.from(name + '\0', 'ascii')) },
                  { type: 'SPIT', data: spit }];
  (effectDescs || []).forEach(function (e) {
    fields.push({ type: 'EFID', data: u32(idFor(e)) });
    fields.push({ type: 'EFIT', data: zeros(12) });
  });
  record(desc, 'SPEL', name.replace(/ /g, ''), fields);
}
function perk(desc, editorId) { record(desc, 'PERK', editorId, []); }
/** An MGEF whose DATA has the magic skill at offset 12 and the minimum level at 40. */
function effect(desc, av, level) {
  const data = zeros(152);
  const s = i32(av), l = u32(level);
  for (let i = 0; i < 4; i++) { data[12 + i] = s[i]; data[40 + i] = l[i]; }
  record(desc, 'MGEF', 'Effect' + av + '_' + level, [{ type: 'DATA', data: data }]);
}

// The rulebook's own spells, by the form ids SPELL_IDS gives them.
tome('t-flames:Skyrim.esm', '12fcd:Skyrim.esm');       // Flames, Novice Destruction
tome('t-sparks:Skyrim.esm', '2dd2a:Skyrim.esm');       // Sparks, Novice Destruction
tome('t-frostbite:Skyrim.esm', '2b96b:Skyrim.esm');    // Frostbite, Novice Destruction
tome('t-fireball:Skyrim.esm', '1c789:Skyrim.esm');     // Fireball, Advanced Destruction
tome('t-familiar:Skyrim.esm', '640b6:Skyrim.esm');     // Conjure Familiar, Novice Conjuration
// A magic mod's spells, which the rulebook does not list.
perk('p-adept:Skyrim.esm', 'DestructionAdept50');
spell('s-firehand:Odin.esp', 'Firehand', 'p-adept:Skyrim.esm', []);
tome('t-firehand:Odin.esp', 's-firehand:Odin.esp');
perk('p-odd:Odin.esp', 'OdinSomethingElse');
effect('e-conj75:Odin.esp', 19, 75);
effect('e-heal0:Odin.esp', 22, 0);
spell('s-houndmaster:Odin.esp', 'Conjure Houndmaster', 'p-odd:Odin.esp', ['e-heal0:Odin.esp', 'e-conj75:Odin.esp']);
tome('t-houndmaster:Odin.esp', 's-houndmaster:Odin.esp');
effect('e-nothing:Odin.esp', 25, 0);  // Block, no school
spell('s-strange:Odin.esp', 'Strange Light', null, ['e-nothing:Odin.esp']);
tome('t-strange:Odin.esp', 's-strange:Odin.esp');
// A book that teaches nothing.
record('lore:Skyrim.esm', 'BOOK', 'SomeLore', [{ type: 'DATA', data: [0, 0, 0, 0].concat(u32(0), u32(10), [0, 0, 128, 63]) }]);

// -------------------------------------------------------------- the server --

function server(store) {
  const said = [];
  const logs = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (key === 'profileId') { return 1000 + (id & 0xff); }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    set: function (id, key, value) { (store[id] = store[id] || {})[key] = JSON.stringify(value); },
    getDescFromId: function (n) { return DESCS[n] || ('unknown' + n + ':Nowhere.esp'); },
    lookupEspmRecordById: function (n) {
      const r = RECORDS[n];
      if (!r) { return {}; }
      return { record: r, fileIndex: 0, toGlobalRecordId: function (local) { return local; } };
    }
  };
  const ctx = {
    mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math,
    console: { log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); }, error: function () { } },
    guard: function (name, fn) { return fn; },
    notify: function (id, m) { said.push({ id: id, text: m, how: 'notify' }); },
    say: function (id, m) { said.push({ id: id, text: m, how: 'chat' }); },
    log: function () { }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
  vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  vm.runInContext('function aWord(name) { return "a " + name; }', ctx);
  vm.runInContext(TOMES, ctx, { filename: 'gamemode.js spell tomes' });
  vm.runInContext(STAFF, ctx, { filename: 'gamemode.js staff spells' });
  return {
    said: said, logs: logs, C: ctx.__thornswoodCharacter, P: ctx.__thornswoodProgression,
    T: ctx.__thornswoodTomes,
    read: function (actor, desc) { said.length = 0; return ctx.mp.onReadBook(actor, idFor(desc)); },
    chat: function (actor) { return said.filter(function (x) { return x.id === actor && x.how === 'chat'; }); }
  };
}

const store = {};
const srv = server(store);
const P = srv.P;
function put(actor, s) { srv.C.writeState(actor, s); return srv.C.stateOf(actor); }
function mage(actor, schools, extra) {
  let s = P.pickClass(srv.C.stateOf(actor), 'miner').state;
  s = P.pickProfession(s, 'mage', schools).state;
  if (extra) { extra(s); }
  return put(actor, s);
}
function clean(line) { return line.indexOf(String.fromCharCode(0x2014)) === -1 && !/player/i.test(line); }
function book(actor) { const s = srv.C.stateOf(actor); return (s.spells && s.spells.known) || []; }
function points(actor) { const s = srv.C.stateOf(actor); return (s.spells && s.spells.points) || 0; }

// ------------------------------------------------------------ A. not a tome --
{
  const A = 0xff000101;
  mage(A, ['destruction', 'restoration']);
  const back = srv.read(A, 'lore:Skyrim.esm');
  yes('A a book that teaches no spell is not refused', back === undefined);
  yes('A and nothing is said', srv.said.length === 0);
  const unknown = srv.read(A, 'nothing:Nowhere.esp');
  yes('A a book the records do not know is not refused either, and nothing is said',
      unknown === undefined && srv.said.length === 0);
}

// --------------------------------------------------------- B. the refusals --
{
  // All three at once: a Smith reading Fireball.
  const SMITH = 0xff000201;
  let s = P.pickClass(srv.C.stateOf(SMITH), 'miner').state;
  s = P.pickProfession(s, 'smith', 'edgewright').state;
  put(SMITH, s);
  const back = srv.read(SMITH, 't-fireball:Skyrim.esm');
  const line = (srv.chat(SMITH)[0] || {}).text || '';
  yes('B ISSUE: a Smith reading Fireball is refused, so the engine keeps the tome and takes the spell back',
      back === false);
  yes('B  nothing is learned', book(SMITH).length === 0);
  yes('B  and the one chat line names all three: a spell point, Advanced rank in Destruction, a Novice Destruction spell (' + line + ')',
      srv.chat(SMITH).length === 1 && /Fireball \(Advanced Destruction\)/.test(line) &&
      /a spell point to spend, and you have none/.test(line) &&
      /magic is not yours until a Master mage takes you on/.test(line) &&
      /Advanced rank in Destruction, and you have no rank in it/.test(line) &&
      /a Novice Destruction spell you already know/.test(line) && /you keep it/.test(line));
  yes('B  with no em dash and no word player', clean(line));

  // Level only: a mage whose schools are elsewhere, with points, reading a Novice spell.
  const M1 = 0xff000202;
  mage(M1, ['destruction', 'restoration']);
  const b1 = srv.read(M1, 't-familiar:Skyrim.esm');
  const l1 = (srv.chat(M1)[0] || {}).text || '';
  yes('B level only: a Destruction and Restoration mage reading Conjure Familiar is refused', b1 === false);
  yes('B  the line names the rank and nothing else (' + l1 + ')',
      /Novice rank in Conjuration, and you have no rank in it/.test(l1) &&
      !/spell point/.test(l1) && !/already know/.test(l1));
  yes('B  and the two points are still there', points(M1) === 2 && book(M1).length === 0);

  // Level and below: a novice mage reading Fireball.
  const b2 = srv.read(M1, 't-fireball:Skyrim.esm');
  const l2 = (srv.chat(M1)[0] || {}).text || '';
  yes('B level and below: a Novice Destruction mage reading Fireball is refused (' + l2 + ')',
      b2 === false && /Advanced rank in Destruction, and you are Novice in it/.test(l2) &&
      /a Novice Destruction spell you already know, and you know none/.test(l2) && !/spell point/.test(l2));

  // Points only: a mage with none left, reading a Novice spell of their school.
  const M2 = 0xff000203;
  mage(M2, ['destruction', 'restoration'], function (x) { x.spells.points = 0; });
  const b3 = srv.read(M2, 't-sparks:Skyrim.esm');
  const l3 = (srv.chat(M2)[0] || {}).text || '';
  yes('B points only: a mage with no spell point left is refused Sparks (' + l3 + ')',
      b3 === false && /a spell point to spend, and you have none \(a mage earns one with every rank, and 2 with a semester at the College\)/.test(l3) &&
      !/rank in/.test(l3) && !/already know/.test(l3));

  // Below only: an Advanced Destruction mage with a point and no Novice Destruction spell.
  const M3 = 0xff000204;
  mage(M3, ['destruction', 'restoration'], function (x) {
    x.ranks.destruction = 'advanced'; x.spells.points = 1; x.spells.known = ['Healing'];
  });
  const b4 = srv.read(M3, 't-fireball:Skyrim.esm');
  const l4 = (srv.chat(M3)[0] || {}).text || '';
  yes('B below only: an Advanced Destruction mage who knows no Novice Destruction spell is refused Fireball (' + l4 + ')',
      b4 === false && /You need a Novice Destruction spell you already know, and you know none\./.test(l4) &&
      !/spell point/.test(l4) && !/rank in/.test(l4));
  yes('B every refusal line is clean', [l1, l2, l3, l4].every(clean));
}

// ----------------------------------------------------------- C. the passes --
{
  const M = 0xff000301;
  mage(M, ['destruction', 'restoration']);
  const back = srv.read(M, 't-flames:Skyrim.esm');
  const line = (srv.chat(M)[0] || {}).text || '';
  yes('C a Novice Destruction mage with a point reads Flames: not refused, so the engine teaches it and spends the tome',
      back === undefined);
  yes('C  Flames is in their book and a point is spent', book(M).indexOf('Flames') !== -1 && points(M) === 1);
  yes('C  and the line says what was learned and what it cost (' + line + ')',
      /The tome teaches you Flames, Novice Destruction\. It cost a spell point\./.test(line) && clean(line));

  // Advanced, with the Novice below and a point: Fireball.
  mage(M, ['destruction', 'restoration'], function (x) {
    x.ranks.destruction = 'advanced'; x.spells.points = 1; x.spells.known = ['Flames'];
  });
  const b2 = srv.read(M, 't-fireball:Skyrim.esm');
  yes('C an Advanced Destruction mage who knows Flames and has a point learns Fireball',
      b2 === undefined && book(M).indexOf('Fireball') !== -1 && points(M) === 0);
  yes('C  the same answer the panel gives for /pick spell Fireball',
      P.pickSpell(Object.assign(P.fresh(), { prof: 'mage', schools: ['destruction', 'restoration'],
        ranks: { destruction: 'advanced', restoration: 'novice' }, spells: { points: 1, known: ['Flames'] } }), 'Fireball').ok);
}

// ------------------------------------------ D. somebody a Master mage taught --
{
  const T = 0xff000401;
  let s = P.pickClass(srv.C.stateOf(T), 'miner').state;
  s = P.pickProfession(s, 'smith', 'edgewright').state;
  const teacher = { prof: 'mage', ranks: { destruction: 'master' } };
  s = P.teach(s, teacher, 'destruction').state;
  put(T, s);
  const DAY = 24 * 3600000;
  const t0 = 1800000000000;
  const b0 = srv.read(T, 't-flames:Skyrim.esm');
  const l0 = (srv.chat(T)[0] || {}).text || '';
  yes('D a Smith a Master mage taught Destruction needs a semester at the College before a tome teaches them (' + l0 + ')',
      b0 === false && book(T).length === 0 && /anybody who is not a Mage earns one with a semester at the College/.test(l0));
  function semester(at) { put(T, P.study(srv.C.stateOf(T), at).state); }
  semester(t0);
  yes('D  and after one, reads Flames and learns it', srv.read(T, 't-flames:Skyrim.esm') === undefined &&
      book(T).indexOf('Flames') !== -1 && points(T) === 0);
  semester(t0 + DAY);
  yes('D  and Sparks, the second place under the cap, after the next', srv.read(T, 't-sparks:Skyrim.esm') === undefined &&
      book(T).indexOf('Sparks') !== -1);
  semester(t0 + 2 * DAY);
  const back = srv.read(T, 't-frostbite:Skyrim.esm');
  const line = (srv.chat(T)[0] || {}).text || '';
  yes('D  the third is refused even with a semester\'s point: the cap holds, and the line says so (' + line + ')',
      back === false && book(T).indexOf('Frostbite') === -1 &&
      /anybody who is not a Mage holds 2 spells at most/.test(line));
  const b2 = srv.read(T, 't-fireball:Skyrim.esm');
  const l2 = (srv.chat(T)[0] || {}).text || '';
  yes('D  and a taught school never leaves Novice, so Fireball names the rank too (' + l2 + ')',
      b2 === false && /Advanced rank in Destruction, and you are Novice in it/.test(l2));
}

// ------------------------------------------- E. spells the rulebook lacks --
{
  const M = 0xff000501;
  mage(M, ['destruction', 'conjuration'], function (x) {
    x.ranks.destruction = 'advanced'; x.spells.points = 3; x.spells.known = ['Flames'];
  });
  const fh = srv.T.tomeSpell(idFor('t-firehand:Odin.esp'));
  yes('E a mod spell takes its school and rank from its half cost perk (DestructionAdept50 is Advanced Destruction)',
      fh && fh.name === 'Firehand' && fh.school === 'destruction' && fh.rank === 'advanced');
  const T1 = srv.read(M, 't-firehand:Odin.esp');
  const line = (srv.chat(M)[0] || {}).text || '';
  const st = srv.C.stateOf(M);
  yes('E  and it is refused all the same: only the book is granted (#1387), the tome is kept and nothing is spent (' + line + ')',
      T1 === false && /You cannot learn Firehand from this tome: it is not in the College's book/.test(line) &&
      /You keep the tome/.test(line) && book(M).indexOf('Firehand') === -1 && points(M) === 3 && !st.spells.tomes && clean(line));
  srv.logs.length = 0;
  srv.C.grantKnown(M);
  yes('E  and putting known spells back at a spawn puts back the book and nothing else',
      srv.logs.some(function (l) { return /Flames/.test(l); }) &&
      !srv.logs.some(function (l) { return /Firehand/.test(l); }));

  const hm = srv.T.tomeSpell(idFor('t-houndmaster:Odin.esp'));
  const b2 = srv.read(M, 't-houndmaster:Odin.esp');
  const l2 = (srv.chat(M)[0] || {}).text || '';
  yes('E a perk that names no school falls back to the effects: the highest level of a school decides (Expert Conjuration), and it is refused as off the book (' + l2 + ')',
      hm && hm.school === 'conjuration' && hm.rank === 'expert' &&
      b2 === false && /You cannot learn Conjure Houndmaster from this tome: it is not in the College's book/.test(l2));

  const b3 = srv.read(M, 't-strange:Odin.esp');
  const l3 = (srv.chat(M)[0] || {}).text || '';
  yes('E a spell with no school that can be read is not the book\'s: refused as off the book, kept, and nobody is sent to staff (#1127) (' + l3 + ')',
      b3 === false && /You cannot learn Strange Light from this tome: it is not in the College's book/.test(l3) &&
      /You keep the tome/.test(l3) && !/staff|helpme/i.test(l3) && clean(l3));
  yes('E  and the log names it', srv.logs.some(function (l) { return /no school and rank readable/.test(l) && /s-strange/.test(l); }));
  yes('E Skyrim levels to ranks: 0 Novice, 25 and 50 Advanced, 75 Expert, 100 Master',
      P.rankForLevel(0) === 'novice' && P.rankForLevel(25) === 'advanced' && P.rankForLevel(50) === 'advanced' &&
      P.rankForLevel(75) === 'expert' && P.rankForLevel(100) === 'master');
}

// ------------------------------------------------------- F. already known --
{
  const M = 0xff000601;
  mage(M, ['destruction', 'restoration'], function (x) { x.spells.known = ['Flames']; x.spells.points = 1; });
  const back = srv.read(M, 't-flames:Skyrim.esm');
  yes('F a spell already in the book is not refused and not charged for again',
      back === undefined && points(M) === 1 && book(M).filter(function (n) { return n === 'Flames'; }).length === 1);
  yes('F  and nothing is said', srv.said.length === 0);
}

// ---------------------------------------------- G. a master spell needs the tome --
{
  const state = Object.assign(P.fresh(), {
    prof: 'mage',
    schools: ['destruction'],
    ranks: { destruction: 'master' },
    spells: { points: 1, known: ['Wall of Flames'] }
  });
  const refused = P.pickSpell(state, 'Fire Storm');
  yes('G a master spell chosen off the book without its tome is refused (' + (refused.why || '') + ')',
      refused.ok === false && /tome/.test(refused.why || ''));
  const learned = P.pickSpell(state, 'Fire Storm', true);
  yes('G the same mage with the tome, master rank, and a point learns Fire Storm',
      learned.ok === true && learned.state.spells.known.indexOf('Fire Storm') !== -1);
  yes('G Fire Storm\'s tome is the book',
      P.masterTomeDesc('Fire Storm') === 'a270c:Skyrim.esm');
}

// ------------------------------------------------------- the handler itself --
{
  const lines = src.split('\n').filter(function (l) { return /^mp\.onReadBook\s*=/.test(l); });
  yes('mp.onReadBook is registered once, through guard under its own name',
      lines.length === 1 && lines[0].indexOf("guard('onReadBook', function") !== -1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
