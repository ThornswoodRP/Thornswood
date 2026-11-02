// test-2675-hair-dye.js
//
//     node tests/test-2675-hair-dye.js
//
// #2675, the first slice of hair dye: the staff's list in
// game/data/hair-dyes.json and the pure module game/hair-dye.js that reads it.
// The gamemode's hair dye block carries both and calls them; that wiring
// is tests/test-2675-hair-dye-wiring.js.
//
// D: THE LIST. The real list passes checkDyes, and every bad shape a staff
//    edit could make is refused with a sentence, never fallen back from.
// T: THE ITEM TABLE. Every record the list names is one the gamemode's own
//    tables know, the dyes steep at a bench keyword BENCH_ACCESS knows, and
//    any half the list names is a half there.
// B: THE BASE. The dye is carried as a vanilla misc record that no other part
//    of the game reads, so nothing that counts the plain record (a well, a
//    merchant, the take limit) mistakes a dye for it or a plain one for a dye.
//    When the game's Data folder is on this machine (THORNSWOOD_DATA, or
//    C:\Thornswood\Game\Data) the record is read out of the plugin and must be
//    a MISC; where it is not (CI) that check says SKIP.
// C: THE COLOUR SUMS. Every result is 0 to 0xFFFFFF, the edges come out
//    exactly, a wash goes back towards the made colour, and the engine's
//    signed int32 colours are read by their low 24 bits.
// A: THE APPEARANCE. withHairColour changes the hair colour and nothing else,
//    never touches what it was handed, and what it gives passes the
//    gamemode's real bodyShapeGuard unchanged.
// N: THE NAME. A dye's entry carries its name, survives the JSON the engine
//    stores, and is known again by it; the first dye the pack can make is the
//    one made, and who may steep follows the list.
// W: THE MODULE AND THE WORDS. The module names no record, colour or dye of
//    the list's, and no name in the list has a long dash or the word the
//    house style keeps out.
//
// Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR).join('');

let pass = 0, fail = 0, skip = 0;
function yes(what, cond, more) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (more ? ' (' + more + ')' : '')); }
}
function skipped(what, why) { skip++; console.log('SKIP  ' + what + ' (' + why + ')'); }

const DATA_FILE = path.join(REPO_DIR, 'game', 'data', 'hair-dyes.json');
const MODULE_FILE = path.join(REPO_DIR, 'game', 'hair-dye.js');
const data = JSON.parse(read(DATA_FILE));
const dye = require(MODULE_FILE);
const gm = require('./gamemode-tables.js').joined(read(path.join(REPO_DIR, 'game', 'gamemode.js')));
const clone = (o) => JSON.parse(JSON.stringify(o));

function between(text, from, to) {
  const a = text.indexOf(from);
  const b = a < 0 ? -1 : text.indexOf(to, a);
  return a < 0 || b < 0 ? '' : text.slice(a, b);
}
function allRecords(d) {
  const out = [d.item];
  d.dyes.forEach((x) => x.inputs.forEach((p) => out.push(p.item)));
  return out;
}

// ------------------------------------------------------------- D: the list
const problems = dye.checkDyes(data);
yes('D1 the real list passes checkDyes', problems.length === 0, problems.join('; '));
yes('D2 the list has dyes and a wash', data.dyes.some((d) => d.wash !== true) && data.dyes.some((d) => d.wash === true));
// Patrick, 18 Oct 2026 (#2675): making dye is a tailor's job. The Tailor's two
// halves, the loom's own row in BENCH_ACCESS, each from novice.
yes('D3 who is the Tailor\'s two halves, from novice: anyone false', data.who.anyone === false &&
    JSON.stringify(data.who.halves) === JSON.stringify({ haberdasher: 'novice', liverywright: 'novice' }));

const BAD = [
  ['a key nobody reads at the top', (d) => { d.fades = true; }, /key nobody reads: fades/],
  ['no item', (d) => { delete d.item; }, /item is not a record/],
  ['an item that is not a record', (d) => { d.item = 'Bowl'; }, /item is not a record/],
  ['a steep of 0 seconds', (d) => { d.steepSeconds = 0; }, /steepSeconds/],
  ['a steep of half a second', (d) => { d.steepSeconds = 0.5; }, /steepSeconds/],
  ['no bench to steep at', (d) => { d.steepAt = ''; }, /steepAt/],
  ['who missing', (d) => { delete d.who; }, /who is not an object/],
  ['who.anyone not a yes or no', (d) => { d.who.anyone = 'yes'; }, /who\.anyone/],
  ['a rank that is not a rank', (d) => { d.who.halves = { hearthcook: 'grandmaster' }; }, /not novice, advanced, expert or master/],
  ['nobody at all may steep', (d) => { d.who.anyone = false; d.who.halves = {}; }, /lets nobody/],
  ['an empty list', (d) => { d.dyes = []; }, /dyes is not a list/],
  ['two dyes with one id', (d) => { d.dyes[1].id = d.dyes[0].id; }, /same id/],
  ['two dyes with one name, told apart by case only', (d) => { d.dyes[1].name = d.dyes[0].name.toUpperCase(); }, /same name/],
  ['a dye with no name', (d) => { d.dyes[0].name = ' '; }, /has no name/],
  ['a colour that is not #rrggbb', (d) => { d.dyes[0].colour = 'black'; }, /no colour/],
  ['a colour in capitals', (d) => { d.dyes[0].colour = d.dyes[0].colour.toUpperCase().replace('#', '#A'); }, /no colour/],
  ['a dye with no colour', (d) => { delete d.dyes[0].colour; }, /no colour/],
  ['a wash with a colour', (d) => { d.dyes.filter((x) => x.wash)[0].colour = '#ffffff'; }, /is a wash and has a colour/],
  ['wash set to false', (d) => { d.dyes[0].wash = false; }, /wash set to something/],
  ['a strength of 0', (d) => { d.dyes[0].strength = 0; }, /strength/],
  ['a strength above 1', (d) => { d.dyes[0].strength = 1.5; }, /strength/],
  ['a wander above the most', (d) => { d.dyes[0].wander = dye.WANDER_MAX + 1; }, /wander/],
  ['a wander that is not whole', (d) => { d.dyes[0].wander = 2.5; }, /wander/],
  ['a dye that takes nothing', (d) => { d.dyes[0].inputs = []; }, /takes nothing/],
  ['an input that is not a record', (d) => { d.dyes[0].inputs[0].item = 'charcoal'; }, /input 1 is not a record/],
  ['an input named twice', (d) => { d.dyes[0].inputs.push(clone(d.dyes[0].inputs[0])); }, /twice/],
  ['an input of none', (d) => { d.dyes[0].inputs[0].count = 0; }, /count/],
  ['an input that is the dye item itself', (d) => { d.dyes[0].inputs[0].item = d.item; }, /dye item itself/],
  ['a key nobody reads on a dye', (d) => { d.dyes[0].fadeDays = 3; }, /key nobody reads: fadeDays/],
  ['a dye that can never be made, its inputs holding an earlier one\'s',
    (d) => { const later = clone(d.dyes[0]); later.id = 'later'; later.name = 'Later'; later.inputs[0].count += 1; d.dyes.push(later); },
    /can never be made/]
];
for (const [what, change, want] of BAD) {
  const d = clone(data);
  change(d);
  const p = dye.checkDyes(d);
  yes('D refuses ' + what, p.length > 0 && p.some((s) => want.test(s)), p.join('; ') || 'nothing refused');
}
yes('D refuses a list that is not an object', dye.checkDyes(null).length === 1 && dye.checkDyes([]).length === 1);

// ------------------------------------------------------- T: the item table
// The gamemode reads ITEM_NAMES, ADMIN_ITEMS and ADMIN_ACTORS from
// game/gamemode-tables (#5191): lower-case name -> [name, record].
const GT = require('./gamemode-tables.js');
const ITEM_T = GT.table('ITEM_NAMES');
const ADMIN_T = Object.assign({}, GT.table('ADMIN_ACTORS'), GT.table('ADMIN_ITEMS'));
yes('T0 the gamemode\'s item tables are found', Object.keys(ITEM_T).length > 100 && Object.keys(ADMIN_T).length > 1000);
const records = {};
[ITEM_T, ADMIN_T].forEach((t) => Object.keys(t).forEach((k) => { records[t[k][1]] = true; }));
const known = (rec) => !!records[rec];
const unknown = allRecords(data).filter((r) => !known(r));
yes('T1 every record the list names is in the gamemode\'s item tables', unknown.length === 0, unknown.join(', '));
const accessLine = /const BENCH_ACCESS = (\{[^\n]*\});/.exec(gm);
const access = accessLine ? JSON.parse(accessLine[1]) : {};
yes('T2 the dyes steep at a bench keyword BENCH_ACCESS knows', Object.prototype.hasOwnProperty.call(access, data.steepAt), data.steepAt);
const cook = /cookKeyword: '([^']+)'/.exec(gm);
yes('T3 that keyword is the one water boils at', !!cook && cook[1] === data.steepAt, cook ? cook[1] : 'no cookKeyword');
const halves = {};
Object.keys(access).forEach((k) => Object.keys(access[k].halves || {}).forEach((h) => { halves[h] = true; }));
const strange = Object.keys(data.who.halves).filter((h) => !halves[h]);
yes('T4 every half the list names is a half BENCH_ACCESS knows', Object.keys(halves).length > 5 && strange.length === 0, strange.join(', '));
// Making dye is a tailor's job (Patrick, 18 Oct): the halves are the Tailor
// profession's, exactly, and the loom (the Tailor's own bench) names the same.
const tailorRow = /tailor:\s*\{ name: 'Tailor',\s*halves: \{ ([^}]*) \}/.exec(gm);
const tailorHalves = tailorRow ? tailorRow[1].split(',').map((s) => s.split(':')[0].trim()).sort() : [];
yes('T6 who names the Tailor\'s halves and nobody else\'s', tailorHalves.length === 2 &&
    JSON.stringify(Object.keys(data.who.halves).sort()) === JSON.stringify(tailorHalves), tailorHalves.join(', '));
const loom = Object.keys(access).map((k) => access[k]).find((b) => b.name === 'MCE_CraftingLoom');
yes('T7 ...the same halves the loom row in BENCH_ACCESS names', !!loom &&
    JSON.stringify(Object.keys(loom.halves).sort()) === JSON.stringify(tailorHalves));
const expert = clone(data); expert.who = { anyone: false, halves: { haberdasher: 'expert' } };
yes('T8 expert is a rank the list may name, as RANK_LADDER has it', dye.checkDyes(expert).length === 0 &&
    /const RANK_LADDER = \['novice', 'advanced', 'expert', 'master'\];/.test(gm));
const water = /waterItems: \{ empty: '([^']+)', full: '([^']+)' \}/.exec(gm);
const waterless = data.dyes.filter((d) => !water || !d.inputs.some((p) => p.item === water[2])).map((d) => d.id);
yes('T5 every dye takes a bottle of water, the record the needs code fills', !!water && waterless.length === 0, waterless.join(', '));

// ----------------------------------------------------------------- B: the base
const base = data.item;
const fid = parseInt(base.split(':')[0], 16);
// gamemode.js as it is, without its tables: the dye base is in ADMIN_ITEMS's
// file (the /give lookup), which B3 allows, and in the carried list here.
const gmText = read(path.join(REPO_DIR, 'game', 'gamemode.js'));
const gmHits = [];
gmText.split('\n').forEach((l, i) => { if (l.indexOf(base) >= 0) gmHits.push(i + 1); });
// And in the HAIR_DYES region, the list itself as Build-HairDyeGamemode.js
// carries it into the hair dye block (slice 2), which test-2675-hair-dye-wiring.js
// checks is the list byte for byte.
const dyesFrom = gmText.split('\n').findIndex((l) => l === '  // ==== HAIR_DYES ====') + 1;
const dyesTo = gmText.split('\n').findIndex((l) => l === '  // ==== end HAIR_DYES ====') + 1;
const inList = (n) => dyesFrom > 0 && n > dyesFrom && n < dyesTo;
yes('B1 the gamemode names the dye base only in ADMIN_ITEMS, the /give lookup, and the carried list',
    gmHits.length >= 1 && gmHits.every(inList) && ADMIN_T[Object.keys(ADMIN_T).find((k) => ADMIN_T[k][1] === base)] !== undefined,
    'lines ' + gmHits.join(', '));
yes('B2 ...and not by its bare form id either', !new RegExp('0x0*' + fid.toString(16) + '\\b', 'i').test(gm) &&
    !new RegExp('\\b' + fid + '\\b').test(gm.replace(/[0-9.]*\.[0-9]+/g, '')));
const others = [];
function scan(dir, filter) {
  if (!fs.existsSync(dir)) return;
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) { scan(p, filter); continue; }
    if (!filter.test(n) || p === DATA_FILE || /gamemode\.js$/.test(p) || p === GT.file('ADMIN_ITEMS')) continue;
    if (read(p).indexOf(base) >= 0) others.push(path.relative(REPO_DIR, p));
  }
}
scan(path.join(REPO_DIR, 'game'), /\.(js|json|txt|html|css)$/i);
yes('B3 nothing else under game\\ names the dye base', others.length === 0, others.join(', '));
const plainKey = Object.keys(ADMIN_T).find((k) => ADMIN_T[k][1] === '98626:Skyrim.esm');
const plain = plainKey ? ADMIN_T[plainKey][0] : undefined;
yes('B4 the dye names are none of the game\'s own item names', data.dyes.every((d) =>
  !Object.prototype.hasOwnProperty.call(ITEM_T, d.name.toLowerCase()) &&
  !Object.prototype.hasOwnProperty.call(ADMIN_T, d.name.toLowerCase())) && data.dyes.every((d) => d.name !== plain));

const DATA_DIR = process.env.THORNSWOOD_DATA || 'C:\\Thornswood\\Game\\Data';
const PLUGIN = path.join(DATA_DIR, base.split(':')[1]);
function recordType(file, formId) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(24);
    const at = (p) => { fs.readSync(fd, head, 0, 24, p); return head; };
    const size = fs.fstatSync(fd).size;
    let p = 24 + at(0).readUInt32LE(4);
    while (p + 24 <= size) {
      const h = at(p);
      if (h.toString('latin1', 0, 4) !== 'GRUP') return null;
      const groupSize = h.readUInt32LE(4), label = h.toString('latin1', 8, 12);
      if (['MISC', 'ALCH', 'INGR', 'BOOK', 'ARMO', 'WEAP', 'KEYM', 'SLGM', 'AMMO', 'SCRL'].indexOf(label) >= 0) {
        const g = Buffer.alloc(groupSize);
        fs.readSync(fd, g, 0, groupSize, p);
        let q = 24;
        while (q + 24 <= groupSize) {
          const tag = g.toString('latin1', q, q + 4), len = g.readUInt32LE(q + 4);
          if (tag === 'GRUP') { q += 24; continue; }
          if ((g.readUInt32LE(q + 12) & 0xFFFFFF) === formId) return tag;
          q += 24 + len;
        }
      }
      p += groupSize;
    }
    return null;
  } finally { fs.closeSync(fd); }
}
if (fs.existsSync(PLUGIN)) {
  const t = recordType(PLUGIN, fid);
  yes('B5 the dye base is a MISC record in ' + path.basename(PLUGIN), t === 'MISC', String(t));
} else {
  skipped('B5 the dye base is a MISC record', 'no ' + PLUGIN + ' on this machine');
}

// ------------------------------------------------------- C: the colour sums
let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const mid = () => 0.5;
const ch = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const dyes = data.dyes.filter((d) => !d.wash);
const wash = data.dyes.filter((d) => d.wash)[0];
let inRange = true, tries = 0;
for (const d of data.dyes) {
  for (const old of [0, 0xFFFFFF, 0x808080, 0x123456, -1, -16777216, 0x7FFFFFFF, 0xFF2B3F6E]) {
    const c = dye.mixColour(old, d, 0x6a4a30, rand);
    tries++;
    if (!(Number.isSafeInteger(c) && c >= 0 && c <= 0xFFFFFF)) inRange = false;
  }
}
yes('C1 every result over ' + tries + ' tries is a colour 0 to 0xFFFFFF', inRange);
const sharp = Object.assign(clone(dyes[0]), { strength: 1, wander: 0 });
yes('C2 strength 1 with no wander gives the dye\'s colour exactly', dye.mixColour(0x123456, sharp, null, rand) === parseInt(sharp.colour.slice(1), 16));
const none = Object.assign(clone(dyes[0]), { strength: 0, wander: 0 });
yes('C3 strength 0 with no wander leaves the old colour', dye.mixColour(0x123456, none, null, rand) === 0x123456);
const half = Object.assign(clone(dyes[0]), { colour: '#ffffff', strength: 0.5, wander: 0 });
yes('C4 half strength lands half way', dye.mixColour(0x000000, half, null, rand) === 0x808080);
const wide = Object.assign(clone(dyes[0]), { colour: '#808080', strength: 1, wander: 10 });
yes('C5 the wander moves each channel by at most the wander', [0, 0.25, 0.75, 0.999].every((r) =>
  ch(dye.mixColour(0, wide, null, () => r)).every((v) => Math.abs(v - 128) <= 10)));
yes('C6 ...and a rand of one half moves nothing', dye.mixColour(0, wide, null, mid) === 0x808080);
const many = new Set();
for (let i = 0; i < 20; i++) many.add(dye.mixColour(0x404040, dyes[0], null, rand));
yes('C7 one dye on twenty heads of one colour does not come out the same every time', many.size > 1);
const black = parseInt(dyes[0].colour.slice(1), 16);
const once = dye.mixColour(0xd0c080, dyes[0], null, mid);
const twice = dye.mixColour(once, dyes[0], null, mid);
const dist = (a, b) => ch(a).reduce((n, v, i) => n + Math.abs(v - ch(b)[i]), 0);
yes('C8 a second coat of a dye goes further towards it than the first', dist(twice, black) < dist(once, black) && dist(once, black) < dist(0xd0c080, black));
const made = 0xc8a070;
const washed = dye.mixColour(0x1b1918, wash, made, mid);
yes('C9 a wash goes back towards the made colour', dist(washed, made) < dist(0x1b1918, made));
yes('C10 a wash with no made colour cannot be worked out', dye.mixColour(0x1b1918, wash, undefined, mid) === null && dye.mixColour(0x1b1918, wash, 'brown', mid) === null);
yes('C11 a signed int32 colour is read by its low 24 bits', dye.mixColour(0xFF123456 | 0, none, null, mid) === 0x123456 && dye.mixColour(-1, none, null, mid) === 0xFFFFFF);
yes('C12 an old colour that is not a whole number cannot be worked out', [null, undefined, '0x123456', 1.5, NaN].every((o) => dye.mixColour(o, dyes[0], null, mid) === null));
yes('C13 a rand that is not a function giving 0 up to 1 cannot be worked out', dye.mixColour(0, dyes[0], null) === null &&
  dye.mixColour(0, dyes[0], null, () => 1) === null && dye.mixColour(0, dyes[0], null, () => -0.1) === null && dye.mixColour(0, dyes[0], null, () => NaN) === null);

// ------------------------------------------------------- A: the appearance
const bodyStart = gm.indexOf('const BODY_APPEARANCE_FIELDS');
const bodyEnd = gm.indexOf('/** Puts one character\'s stored appearance through bodyShapeGuard. */');
let bodyShapeGuard = null;
try {
  bodyShapeGuard = new vm.Script(gm.slice(bodyStart, bodyEnd) + '\n;({ bodyShapeGuard, BODY_APPEARANCE_FIELDS })')
    .runInNewContext({ mp: { getServerSettings: () => ({}) } });
} catch (e) { bodyShapeGuard = null; }
yes('A0 the gamemode\'s bodyShapeGuard is found and runs', !!bodyShapeGuard && bodyStart > 0 && bodyEnd > bodyStart);
const fields = bodyShapeGuard ? bodyShapeGuard.BODY_APPEARANCE_FIELDS : [];
const look = {
  isFemale: true, raceId: 0x13746, weight: 42, skinColor: -9280160, hairColor: -14082545,
  headpartIds: [0x1d6a, 0x51621, 0xe8d56], headTextureSetId: 0x2f3a, options: [0, 1, 2, 3],
  presets: [1, 2, 3, 4], tints: [{ texturePath: 'Actors\\Character\\Character Assets\\TintMasks\\SkinTone.dds', argb: -9280160, type: 6 }],
  name: 'Ysolda'
};
yes('A1 the appearance in this test has every field the engine keeps, and only those', fields.length === 11 &&
  fields.every((k) => Object.prototype.hasOwnProperty.call(look, k)) && Object.keys(look).length === 11);
const before = clone(look);
const dyed = dye.withHairColour(look, 0x2b3f6e);
yes('A2 withHairColour gives the new hair colour', !!dyed && dyed.hairColor === 0x2b3f6e);
yes('A3 ...and the other ten fields exactly as they were', !!dyed &&
  fields.filter((k) => k !== 'hairColor').every((k) => JSON.stringify(dyed[k]) === JSON.stringify(look[k])) && Object.keys(dyed).length === 11);
yes('A4 ...and never touches the one it was handed', JSON.stringify(look) === JSON.stringify(before) && dyed !== look && dyed.tints !== look.tints);
const guarded = bodyShapeGuard ? bodyShapeGuard.bodyShapeGuard(dyed) : null;
yes('A5 what it gives passes the real bodyShapeGuard unchanged', !!guarded && guarded.changes.length === 0 &&
  JSON.stringify(guarded.appearance) === JSON.stringify(dyed), guarded ? guarded.changes.join(', ') : 'no guard');
yes('A6 it refuses what is not an appearance', [null, [], 'look', {}, { hairColor: 1 }, { hairColor: 1, raceId: 2 },
  Object.assign(clone(look), { hairColor: '1' })].every((a) => dye.withHairColour(a, 0x123456) === null));
yes('A7 it refuses a colour that is not 0 to 0xFFFFFF', [-1, 0x1000000, 1.5, '0x123456', null].every((c) => dye.withHairColour(look, c) === null) &&
  dye.withHairColour(look, 0) !== null && dye.withHairColour(look, 0xFFFFFF) !== null);
const mixed = dye.mixColour(look.hairColor, dyes[0], null, rand);
const full = dye.withHairColour(look, mixed);
yes('A8 a dye mixed over a stored signed colour writes back through the guard unchanged', !!full &&
  bodyShapeGuard.bodyShapeGuard(full).changes.length === 0);

// ----------------------------------------------------------------- N: the name
const ITEM_ID = 0x98626;
let round = true;
for (const d of data.dyes) {
  const entry = JSON.parse(JSON.stringify({ baseId: ITEM_ID, count: 1, name: dye.dyeName(d) }));
  if (dye.dyeOf(entry, data, ITEM_ID) !== d || dye.dyeOf(entry, data) !== d) round = false;
}
yes('N1 every dye\'s entry survives the stored JSON and is known again by its name', round);
yes('N2 a plain entry of the base is not a dye', dye.dyeOf({ baseId: ITEM_ID, count: 3 }, data, ITEM_ID) === null &&
  dye.dyeOf({ baseId: ITEM_ID, count: 1, name: plain || 'Bowl' }, data, ITEM_ID) === null);
yes('N3 a dye\'s name on another base is not a dye', dye.dyeOf({ baseId: ITEM_ID + 1, count: 1, name: dyes[0].name }, data, ITEM_ID) === null);
yes('N4 a name is matched exactly, not by case', dye.dyeOf({ baseId: ITEM_ID, count: 1, name: dyes[0].name.toLowerCase() }, data, ITEM_ID) === null);
const carry = (d, extra) => { const c = {}; d.inputs.forEach((p) => { c[p.item] = p.count + (extra || 0); }); return c; };
yes('N5 carrying a dye\'s inputs makes that dye', data.dyes.every((d) => dye.dyeFor(carry(d), data) === d));
const both = Object.assign(carry(data.dyes[2]), carry(data.dyes[1]));
yes('N6 carrying two dyes\' inputs makes the one first in the list', dye.dyeFor(both, data) === data.dyes[1]);
const short = carry(dyes[0]); short[dyes[0].inputs[0].item] -= 1;
yes('N7 one short of an input makes nothing', dye.dyeFor(short, data) === null && dye.dyeFor({}, data) === null && dye.dyeFor(null, data) === null);
yes('N8 the list as it is lets a Haberdasher or a Liverywright steep, and nobody else',
    dye.mayMake(data, (h) => h === 'haberdasher') === true && dye.mayMake(data, (h) => h === 'liverywright') === true &&
    dye.mayMake(data, (h) => h === 'hearthcook') === false && dye.mayMake(data) === false);
const open = clone(data); open.who = { anyone: true, halves: {} };
yes('N8b a list set back to anyone lets anyone steep', dye.mayMake(open) === true && dye.mayMake(open, () => false) === true);
const closed = clone(data); closed.who = { anyone: false, halves: { hearthcook: 'advanced' } };
const asked = [];
yes('N9 a closed list asks the caller about each half at its rank', dye.mayMake(closed, (h, r) => { asked.push(h + ' ' + r); return h === 'hearthcook' && r === 'advanced'; }) === true &&
  asked.join() === 'hearthcook advanced');
yes('N10 ...and refuses when the caller says no or cannot say', dye.mayMake(closed, () => false) === false && dye.mayMake(closed) === false &&
  dye.mayMake(closed, () => 'yes') === false);

// --------------------------------------------------- W: the module and words
const src = read(MODULE_FILE);
const named = allRecords(data).concat(data.steepAt).filter((r) => src.indexOf(r.split(':')[0] + ':') >= 0);
yes('W1 the module names no record of the list\'s', named.length === 0 && !/['"][0-9a-f]{1,8}:[^'"]+\.es[mpl]['"]/i.test(src), named.join(', '));
yes('W2 the module names no colour', !/#[0-9a-f]{6}\b/i.test(src) && !/0x[0-9a-f]{6}\b/i.test(src.replace(/0xFFFFFF/g, '')));
const quoted = (src.match(/'[^'\n]*'|"[^"\n]*"/g) || []).map((s) => s.slice(1, -1).toLowerCase());
const spoken = data.dyes.filter((d) => quoted.indexOf(d.id) >= 0 || quoted.indexOf(d.name.toLowerCase()) >= 0).map((d) => d.id);
yes('W3 the module names no dye of the list\'s', spoken.length === 0, spoken.join(', '));
const words = [data.about].concat(data.dyes.map((d) => d.name));
yes('W4 no long dash in the list', words.every((w) => w.indexOf('\u2014') < 0 && w.indexOf('\u2013') < 0));
const banned = ['pl', 'ayer'].join('');
yes('W5 no word the house style keeps out', words.every((w) => !new RegExp('\\b' + banned + 's?\\b', 'i').test(w)) &&
  !new RegExp('\\b' + banned + 's?\\b', 'i').test(src));
const gx = read(path.join(REPO_DIR, 'tests', 'gate-excluded.txt'));
yes('W6 build.yml runs this harness (it is not in tests/gate-excluded.txt, #3009)', !/^test-2675-hair-dye\.js\s/m.test(gx));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');
process.exit(fail ? 1 : 0);
