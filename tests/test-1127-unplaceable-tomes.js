// test-1127-unplaceable-tomes.js
//
// #1127. Five books in the server's load order teach a spell whose school and
// rank no rule can read: the Oghma Infinium (1a332:Skyrim.esm, which
// ZIA_Complete Pack.esp makes teach d788c, Dragon Knowledge) and the four
// Fishing in Skyrim cheat books (27a95, 27a96, 27a97, 27a9b). Since #1026
// they were refused with "its school and rank cannot be read ... tell staff
// with /helpme", which asked for reports about books nothing is wrong with.
//
// None of the five spells is on a school's page, and magic.md grants only the
// book's, so each is refused the way every tome the book does not list is
// (#1387), with the same line, and the tome is kept.
//
// This runs the real blocks out of game/gamemode.js in a sandbox with a fake
// mp whose lookupEspmRecordById answers made-up records in the engine's shape
// at those five form ids, and proves:
//   A. each of the five, read by a mage, by somebody nobody taught, by
//      somebody a Master mage taught after a semester, and by an Enchanter,
//      is refused: the engine keeps the tome, nothing is learned or spent
//   B. the line is the off-book line, word for word the one a readable mod
//      spell gets, and sends nobody to staff
//   C. the log names each, so staff can still read what was refused
//   D. a tome of the book still teaches
//   E. the MEASURED note in the spell tomes block says which, and the page says so
//
// Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(REPO, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');
const magic = fs.readFileSync(path.join(REPO, 'docs', 'systems', 'magic.md'), 'utf8').split(CR).join('');

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
yes('the rules, the character store, the spell tomes block and the staff spells block are in the gamemode',
    !!(RULES && CHARACTER && TOMES && STAFF));
if (!(RULES && CHARACTER && TOMES && STAFF)) { done(); }

// ------------------------------------------------------------ the records --
const IDS = {};
const DESCS = {};
let nextId = 0x100;
function idFor(desc) {
  if (!Object.prototype.hasOwnProperty.call(IDS, desc)) { IDS[desc] = ++nextId; DESCS[nextId] = desc; }
  return IDS[desc];
}
function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
function zeros(n) { const a = []; for (let i = 0; i < n; i++) { a.push(0); } return a; }
const RECORDS = {};
function record(desc, type, editorId, fields) {
  RECORDS[idFor(desc)] = { type: type, editorId: editorId, flags: 0, id: idFor(desc), fields: fields };
}
function tome(tomeDesc, editorId, spellDesc) {
  record(tomeDesc, 'BOOK', editorId, [
    { type: 'DATA', data: [4, 0, 0, 0].concat(u32(idFor(spellDesc)), u32(750), [0, 0, 128, 63]) }
  ]);
}
/** A SPEL of SPIT type spellType, no half cost perk, and effects of no magic school. */
function spell(desc, name, spellType, effectDescs) {
  const spit = zeros(8).concat(u32(spellType)).concat(zeros(20)).concat(u32(0));
  const fields = [{ type: 'FULL', data: Array.from(Buffer.from(name + '\0', 'ascii')) },
                  { type: 'SPIT', data: spit }];
  effectDescs.forEach(function (e) {
    fields.push({ type: 'EFID', data: u32(idFor(e)) });
    fields.push({ type: 'EFIT', data: zeros(12) });
  });
  record(desc, 'SPEL', name.replace(/[^A-Za-z]/g, ''), fields);
}
/** An MGEF whose DATA has actor value av at offset 12 (none of 18 to 22 is a school) and level at 40. */
function effect(desc, av, level) {
  const data = zeros(152);
  const s = u32(av >>> 0), l = u32(level);
  for (let i = 0; i < 4; i++) { data[12 + i] = s[i]; data[40 + i] = l[i]; }
  record(desc, 'MGEF', 'Effect' + desc.split(':')[0], [{ type: 'DATA', data: data }]);
}

effect('e-script:ZIA_Complete Pack.esp', 0xffffffff, 0);   // a script effect: no actor value
effect('e-fish:FishingInSkyrim.esp', 0xffffffff, 0);
const FIVE = [
  { book: '1a332:Skyrim.esm', edid: 'DA04OghmaInfinium', spell: 'd788c:ZIA_Complete Pack.esp', name: 'Dragon Knowledge', type: 2 },
  { book: '27a95:FishingInSkyrim.esp', edid: 'FishingCheatAddPoleSpell', spell: 'rod:FishingInSkyrim.esp', name: 'Fishing Rod Cast', type: 2 },
  { book: '27a96:FishingInSkyrim.esp', edid: 'FishingCheatAddNetSpell', spell: 'net:FishingInSkyrim.esp', name: 'Fishing Net Cast', type: 2 },
  { book: '27a97:FishingInSkyrim.esp', edid: 'FishingCheatAddDynamiteSpell', spell: 'dyn:FishingInSkyrim.esp', name: 'Dynamite Throw', type: 0 },
  { book: '27a9b:FishingInSkyrim.esp', edid: 'FishingCheatAddMineSpell', spell: 'mine:FishingInSkyrim.esp', name: 'Depth Charge Drop', type: 0 }
];
FIVE.forEach(function (f) {
  spell(f.spell, f.name, f.type, [f.spell.indexOf('ZIA') !== -1 ? 'e-script:ZIA_Complete Pack.esp' : 'e-fish:FishingInSkyrim.esp']);
  tome(f.book, f.edid, f.spell);
});
// A readable mod spell, off the book, for the same line: its half cost perk names Adept Destruction.
record('p-adept:Skyrim.esm', 'PERK', 'DestructionAdept50', []);
(function () {
  const spit = zeros(32).concat(u32(idFor('p-adept:Skyrim.esm')));
  record('s-firehand:Odin.esp', 'SPEL', 'Firehand', [
    { type: 'FULL', data: Array.from(Buffer.from('Firehand\0', 'ascii')) }, { type: 'SPIT', data: spit }]);
})();
tome('t-firehand:Odin.esp', 'SpellTomeFirehand', 's-firehand:Odin.esp');
tome('t-flames:Skyrim.esm', 'SpellTomeFlames', '12fcd:Skyrim.esm');   // Flames, the book's

// -------------------------------------------------------------- the server --
const store = {};
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
  notify: function () { },
  say: function (id, m) { said.push({ id: id, text: m }); },
  log: function () { }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
vm.runInContext('function aWord(name) { return "a " + name; }', ctx);
vm.runInContext(TOMES, ctx, { filename: 'gamemode.js spell tomes' });
vm.runInContext(STAFF, ctx, { filename: 'gamemode.js staff spells' });
const C = ctx.__thornswoodCharacter;
const P = ctx.__thornswoodProgression;
const T = ctx.__thornswoodTomes;

function read(actor, desc) { said.length = 0; return mp.onReadBook(actor, idFor(desc)); }
function line(actor) { return said.filter(function (x) { return x.id === actor; }).map(function (x) { return x.text; }).join(' '); }
function put(actor, s) { C.writeState(actor, s); return C.stateOf(actor); }
function snapshot(actor) { return JSON.stringify(C.stateOf(actor)); }
function clean(l) { return l.indexOf(String.fromCharCode(0x2014)) === -1 && !/\bplayers?\b/i.test(l); }

const miner = function () { return P.pickClass(P.fresh(), 'miner').state; };
const MAGE = 0xff000101, NOBODY = 0xff000102, TAUGHT = 0xff000103, ENCH = 0xff000104;
put(MAGE, (function () {
  const s = P.pickProfession(miner(), 'mage', ['destruction', 'conjuration']).state;
  s.spells.points = 4;
  return s;
})());
put(NOBODY, P.pickProfession(miner(), 'smith', 'edgewright').state);
put(TAUGHT, P.study(P.teach(P.pickProfession(miner(), 'smith', 'edgewright').state,
                            { prof: 'mage', ranks: { destruction: 'master' } }, 'destruction').state, 1800000000000).state);
put(ENCH, P.pickProfession(miner(), 'enchanter', 'bladebinder').state);
const READERS = [['a mage with 4 points', MAGE], ['a Smith nobody taught', NOBODY],
                 ['a Smith a Master mage taught, after a semester', TAUGHT], ['an Enchanter', ENCH]];

// ------------------------------------------------------------- A, B and C --
logs.length = 0;
read(MAGE, 't-firehand:Odin.esp');
const modLine = line(MAGE);
yes('the readable mod spell Firehand is refused as off the book (' + modLine + ')',
    /^You cannot learn Firehand from this tome: it is not in the College's book, and only the book's spells are granted here\. You keep the tome\.$/.test(modLine));
const offWords = modLine.replace(/^You cannot learn Firehand/, '');

FIVE.forEach(function (f) {
  const t = T.tomeSpell(idFor(f.book));
  yes('A ' + f.edid + ' teaches ' + f.name + ', and no school or rank can be read for it',
      !!t && t.name === f.name && t.desc === f.spell && !t.school && !t.rank);
  READERS.forEach(function (who) {
    const before = snapshot(who[1]);
    logs.length = 0;
    const back = read(who[1], f.book);
    const l = line(who[1]);
    yes('A ' + f.edid + ', read by ' + who[0] + ': refused, so the engine keeps the tome, and nothing is learned or spent',
        back === false && snapshot(who[1]) === before);
    yes('B  the line is the off-book line, word for word (' + l + ')',
        l === 'You cannot learn ' + f.name + offWords);
    yes('B  and it sends nobody to staff, tells nobody to type anything, with no em dash and no word player',
        !/staff|helpme|\//i.test(l) && clean(l));
    yes('C  the log names the spell and the reader',
        logs.some(function (x) { return /\[tomes\]/.test(x) && x.indexOf(f.spell) !== -1 && /off the book/.test(x) &&
                                        x.indexOf(Number(who[1]).toString(16)) !== -1; }));
  });
});

// --------------------------------------------------------- D. the book's tome --
const before = C.stateOf(MAGE).spells.points;
const flames = read(MAGE, 't-flames:Skyrim.esm');
yes('D a tome of the book still teaches: the mage reads Flames and it costs a point (' + line(MAGE) + ')',
    flames === undefined && C.stateOf(MAGE).spells.known.indexOf('Flames') !== -1 && C.stateOf(MAGE).spells.points === before - 1);

// ------------------------------------------------------------- E. the note --
const note = (TOMES.match(/MEASURED 29 September[\s\S]*?\*\//) || [''])[0];
yes('E the MEASURED note names the five books', ['1a332:Skyrim.esm', 'Dragon Knowledge', '27a95', '27a96', '27a97', '27a9b:FishingInSkyrim.esp']
    .every(function (w) { return note.indexOf(w) !== -1; }));
yes('E  and says which: reading them is refused as off the book, and the tome is kept (#1127)',
    /WHAT READING THOSE FIVE DOES \(#1127\): it is refused as off the book/.test(note) && /the tome is\s+kept/.test(note));
yes('E the tomes block sends nobody to staff any more', !/tell staff with \/helpme/.test(TOMES));
yes('E magic.md says a tome whose spell has no school is refused as off the book, and names the five',
    /Oghma Infinium/.test(magic) && /fishing mod's four cheat books/.test(magic));

done();
