'use strict';
/*
  test-3160-market-stalls.js

      node tests/test-3160-market-stalls.js

  #3160, player shop stalls. Patrick, 22 Oct 2026, on his report page:
    - stalls are fixed market stalls, claimed like property;
    - a stall sells only while its keeper is there ("No this is an RP server").
  And the rest of the issue: the keeper sets their own prices, in goods or in
  coin, and an item has no gold price of its own (docs/DECIDED.md).

  The book (game/market-stalls.js) is driven on its own first. Then the real
  property block and the real market stalls block run together over a
  pretend engine, with two stalls in the table, and every rule is driven
  through the same /stall lines the stall's panel sends; the real panel page
  draws what the server sent. Last, the wiring: the word, the release part,
  the front plugin's line and its table, and the bundle.
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('./gamemode-tables.js').joined(read(path.join(REPO_DIR, 'game', 'gamemode.js')));
const front = read(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'));
const page = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-stall.js'));
const BOOK = require(path.join(REPO_DIR, 'game', 'market-stalls.js'));
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function throws(f, re) {
  try { f(); return false; } catch (e) { return re.test(String(e && e.message)); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const GOLD = 0x0000000F;
const SWORD = 0x00012EB7;
const INGOT = 0x0005ACE4;
const SALT = 0x00034CDF;
const DAY = 86400000;

// ------------------------------------------------------------------- the book
{
  const T = BOOK.checkTable([
    { id: 'whiterun-1', hold: 'whiterun', place: 'Whiterun market', world: '3c:Skyrim.esm', pos: [0, 0, 0], reach: 200 }
  ]);
  const A = { actor: 0xff000303, profile: 303 }, B = { actor: 0xff000404, profile: 404 };
  const s = BOOK.emptyState();
  BOOK.claim(s, T['whiterun-1'], A, 1000);
  yes('B1 a free stall is claimed by the first who asks, for nothing', BOOK.keeps(s, 'whiterun-1', A));
  yes('  and nobody else can claim it while it is kept', throws(function () { BOOK.claim(s, T['whiterun-1'], B, 1001); }, /already keeps/));
  const n = BOOK.lay(s, 'whiterun-1', A, { baseId: SWORD, count: 2 }, { gold: 30 });
  const n2 = BOOK.lay(s, 'whiterun-1', A, { baseId: SWORD, count: 1 }, { gold: 30 });
  yes('B2 goods are laid out at the keeper\'s price, and the same piece at the same price joins its line',
      n === n2 && s.stalls['whiterun-1'].lines.length === 1 && s.stalls['whiterun-1'].lines[0].count === 3);
  BOOK.lay(s, 'whiterun-1', A, { baseId: SWORD, count: 1, name: 'Ulfric\'s Sword' }, { gold: 30 });
  yes('  a piece that differs (a name, a temper) is a line of its own', s.stalls['whiterun-1'].lines.length === 2);
  yes('B3 gold is a price, never goods on a stall',
      throws(function () { BOOK.lay(s, 'whiterun-1', A, { baseId: GOLD, count: 5 }, { gold: 1 }); }, /price, not goods/));
  yes('  a price in goods is a number of a record, never of gold',
      BOOK.priceOf({ goods: { base: INGOT, count: 2, name: 'Iron Ingot' } }) !== null &&
      BOOK.priceOf({ goods: { base: GOLD, count: 2, name: 'Gold' } }) === null && BOOK.priceOf({ gold: 0 }) === null);
  yes('  nobody but the keeper lays out', throws(function () { BOOK.lay(s, 'whiterun-1', B, { baseId: SWORD, count: 1 }, { gold: 3 }); }, /not yours/));
  for (let i = 0; i < BOOK.MAX_LINES - 2; i++) { BOOK.lay(s, 'whiterun-1', A, { baseId: 0x100 + i, count: 1 }, { gold: 1 }); }
  yes('B4 a stall holds ' + BOOK.MAX_LINES + ' lines, like a trade',
      throws(function () { BOOK.lay(s, 'whiterun-1', A, { baseId: 0x999, count: 1 }, { gold: 1 }); }, /24 lines at most/));
  const sale = BOOK.sell(s, 'whiterun-1', n, 2);
  yes('B5 a sale takes the pieces off the line and names the price for that many',
      sale.piece.count === 2 && sale.cost.gold === 60 && s.stalls['whiterun-1'].lines[0].count === 1 && BOOK.same(sale.keeper, A));
  BOOK.restoreLine(s, 'whiterun-1', sale.line);
  yes('  and a sale that could not finish puts the line back as it was', s.stalls['whiterun-1'].lines[0].count === 3);
  yes('B6 the book is written and read back whole', JSON.stringify(BOOK.openRegister(BOOK.saveRegister(s))) === JSON.stringify(s));
  yes('  a book that does not read is refused, never opened empty',
      throws(function () { BOOK.openRegister('{"version":1,"state":{"stalls":{"x":{"keeper":7}},"out":[],"next":1}}'); }, /does not read/));
  yes('B7 a stall lapses after 14 days with its keeper away, and not before',
      BOOK.lapsed(s, 1000 + 14 * DAY, 14).length === 0 && BOOK.lapsed(s, 1001 + 14 * DAY, 14)[0] === 'whiterun-1');
  BOOK.touch(s, 'whiterun-1', A, 5 * DAY);
  yes('  and the keeper being there keeps it', BOOK.lapsed(s, 1001 + 14 * DAY, 14).length === 0);
  const lines = s.stalls['whiterun-1'].lines.length;
  BOOK.end(s, 'whiterun-1', 'test');
  yes('B8 when its keeping ends the stall is free, and every line is on its way to the hold\'s drop box for its keeper',
      !s.stalls['whiterun-1'] && s.out.length === lines && s.out.every(function (x) { return x.hold === 'whiterun' && BOOK.same(x.of, A) && /^stall:\d+$/.test(x.receipt); }));
  BOOK.claim(s, T['whiterun-1'], A, 2000);
  BOOK.lay(s, 'whiterun-1', A, { baseId: SWORD, count: 1 }, { gold: 30 });
  const c = BOOK.release(s, { actor: function (x) { return x === A.actor; }, profile: function (x) { return x === A.profile; } });
  yes('B9 a deleted person\'s stall ends, its goods to the box with their name off, and pieces on the way lose it too',
      c.stalls === 1 && !s.stalls['whiterun-1'] && s.out.every(function (x) { return x.of === null; }));
  BOOK.claim(s, T['whiterun-1'], A, 3000);
  BOOK.lay(s, 'whiterun-1', A, { baseId: SWORD, count: 1 }, { gold: 30 });
  const was = s.out.length;
  const c2 = BOOK.release(s, { actor: function (x) { return x === A.actor; }, profile: function () { return false; } });
  yes('B9 a reset character\'s stall ends too, and its goods go to the box for the person, who stays',
      c2.stalls === 1 && c2.pieces === 0 && !s.stalls['whiterun-1'] && s.out.length === was + 1 && BOOK.same(s.out[was].of, A));
  yes('B10 the panel\'s words are read strictly',
      BOOK.parse(['/stall', 'lay', '12eb7', '0', '2', 'gold', '30']).price.gold === 30 &&
      BOOK.parse(['/stall', 'lay', '12eb7', '0', '2', 'goods', '5ace4', '2']).price.goods.base === INGOT &&
      !!BOOK.parse(['/stall', 'lay', '12eb7', '0', '2', 'goods', 'f', '2']).why &&
      !!BOOK.parse(['/stall', 'buy', 'x', '1']).why && !!BOOK.parse(['/stall', 'open', '../x']).why);
}

// -------------------------------------------------- the block, over a pretend engine
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
let stallBlock = slice(gm, '// ==== thornswood market stalls ====', '// ==== end thornswood market stalls ====');
yes('the property block and the market stalls block are in the gamemode', !!propBlock && !!stallBlock);
if (!propBlock || !stallBlock) { done(); }
const TABLE = [
  { id: 'whiterun-1', hold: 'whiterun', place: 'Whiterun market', world: '3c:Skyrim.esm', pos: [0, 0, 0], reach: 200 },
  { id: 'riften-1', hold: 'riften', place: 'Riften market', world: '3c:Skyrim.esm', pos: [100000, 0, 0], reach: 200 }
];
stallBlock = stallBlock.replace(/^var MARKET_STALL_TABLE = .*;$/m, function () { return 'var MARKET_STALL_TABLE = ' + JSON.stringify(TABLE) + ';'; });

const clock = { t: Date.UTC(2026, 9, 26, 18, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
const ALICE = { a: 0xff000303, pid: 303, name: 'Alice' };      // keeps the Whiterun stall
const BOB = { a: 0xff000404, pid: 404, name: 'Bob' };          // buys
const STEWARD = { a: 0xff000606, pid: 606, name: 'Proventus' };// Steward of Whiterun
const SAM = { a: 0xff000707, pid: 707, name: 'Sam' };          // staff
const PEOPLE = [ALICE, BOB, STEWARD, SAM];
let online = PEOPLE.map(function (p) { return p.a; });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-3160-stalls-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: { 'steward:whiterun': { 'p:606': { pid: 606, name: 'Proventus' } } } }));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: {}, boards: {}, funds: {}, notices: {} }));
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

const refs = {};
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: '3c:Skyrim.esm',
                pos: [50, 0, 0], inventory: { entries: [{ baseId: GOLD, count: 100 }] } };
});
refs[ALICE.a].inventory.entries.push({ baseId: SWORD, count: 3 }, { baseId: SALT, count: 5 }, { baseId: SWORD, count: 1, worn: true });
refs[BOB.a].inventory.entries.push({ baseId: INGOT, count: 1 });
const shown = {};
const said = {};
const staffLog = [];
// A pack that will not take a write: the id, after skip writes to it go through.
let failPack = null;
function makeMp() {
  return {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (!refs[id]) { throw new Error('no reference ' + id); }
      const v = refs[id][key];
      return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    },
    set: function (id, key, v) {
      if (key === 'thornswoodStallView' || key === 'thornswoodBoxView') { shown[id] = JSON.parse(JSON.stringify(v)); return; }
      if (key === 'inventory' && failPack && failPack.id === id) {
        if (failPack.skip > 0) { failPack.skip--; } else { throw new Error('the pack would not take it'); }
      }
      if (!refs[id]) { refs[id] = {}; }
      refs[id][key] = JSON.parse(JSON.stringify(v));
    },
    getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
    lookupEspmRecordById: function () { return null; },
    getNeighborsByPosition: function () { return []; }
  };
}
let released = null;
function makeWorld(releaseWho) {
  const box = {
    console: { log: function () { } },
    require: require, mp: makeMp(), Date: FakeDate,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
    ITEM_NAMES: { 'iron sword': ['Iron Sword', '12eb7:Skyrim.esm'], 'iron ingot': ['Iron Ingot', '5ace4:Skyrim.esm'],
                  'salt pile': ['Salt Pile', '34cdf:Skyrim.esm'] },
    ADMIN_ITEMS: { 'gold': ['Gold', 'f:Skyrim.esm'] },
    idOf: function (d) { const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(String(d || '')); return m ? parseInt(m[1], 16) : 0; },
    questItemBlocked: function () { return false; },
    notify: function () { }, say: function () { },
    guard: function (n, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { },
    __thornswoodOffices: function (pid) { return { jarl: [], court: [], steward: pid === 606 ? ['whiterun'] : [], guard: [] }; },
    __thornswoodCharacter: { stateOf: function () { return { prof: 'cook' }; }, writeState: function () { } },
    __thornswoodIsStaff: function (pid) { return pid === SAM.pid; },
    __thornswoodStaff: {
      unproven: function () { return ''; },
      record: function () { staffLog.push(Array.prototype.slice.call(arguments)); }
    },
    __thornswoodSayLine: function (pid, what) { (said[pid] = said[pid] || []).push(what); }
  };
  if (releaseWho) {
    box.__thornswoodRelease = function (part, f) { if (part === 'stalls') { released = f(releaseWho); } };
  }
  box.globalThis = box;
  inDir(function () {
    vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' });
    vm.runInNewContext(stallBlock, box, { filename: 'gamemode.js market stalls' });
  });
  return box;
}
let W = makeWorld();
yes('the market stalls block runs beside the property block', !!W.__thornswoodStalls && typeof W.__thornswoodProperty.boxKeep === 'function');

function stall(p, args) {
  let line = '';
  inDir(function () { line = W.__thornswoodStalls.command(['/stall'].concat(args), p.a, p.pid, '/stall ' + args.join(' ')); });
  return { view: shown[p.a], line: line };
}
function count(p, base) {
  return refs[p.a].inventory.entries.reduce(function (s, e) { return s + (e.baseId === base && !e.worn ? e.count : 0); }, 0);
}
function bookFile() { return JSON.parse(fs.readFileSync(path.join(dir, 'private', 'market-stalls.json'), 'utf8')).state; }
function standAt(p, where) { refs[p.a].pos = where === 'away' ? [5000, 0, 0] : where === 'riften' ? [100050, 0, 0] : [50, 0, 0]; }

// ------------------------------------------------------------------ claiming
standAt(ALICE, 'away');
let r = stall(ALICE, ['open', 'whiterun-1']);
yes('S1 away from the stall, the lock key opens nothing', /Stand at the stall/.test(r.line) && !shown[ALICE.a]);
standAt(ALICE, 'stall');
r = stall(ALICE, ['open', 'whiterun-1']);
yes('S2 at the stall, a free stall offers Claim', r.view.open && r.view.free && !r.view.mine && r.view.place === 'Whiterun market');
r = stall(ALICE, ['claim']);
yes('S3 Claim makes it hers, for nothing', r.view.mine && !r.view.free && /The stall is yours/.test(r.view.said) &&
    count(ALICE, GOLD) === 100 && bookFile().stalls['whiterun-1'].keeper.profile === ALICE.pid);
stall(BOB, ['open', 'whiterun-1']);
r = stall(BOB, ['claim']);
yes('  and Bob cannot claim it while she keeps it', /already keeps/.test(r.view.said) && !r.view.mine);
yes('  Bob is never told who keeps it', JSON.stringify(r.view).indexOf('Alice') < 0);

// ----------------------------------------------------------------- laying out
r = stall(ALICE, ['open', 'whiterun-1']);
const swordStack = r.view.pack.filter(function (x) { return x.what === 'Iron Sword'; });
yes('S4 her panel lists what she carries to lay out: not gold, not the sword she wears',
    swordStack.length === 1 && swordStack[0].count === 3 && r.view.pack.every(function (x) { return x.what !== 'Gold'; }));
r = stall(ALICE, ['lay', SWORD.toString(16), '0', '2', 'gold', '30']);
yes('S5 she lays out 2 swords at 30 gold: they leave her pack and are on the stall',
    count(ALICE, SWORD) === 1 && r.view.lines.length === 1 && r.view.lines[0].count === 2 && r.view.lines[0].words === '30 gold');
r = stall(ALICE, ['lay', GOLD.toString(16), '0', '10', 'gold', '1']);
yes('  gold is refused as goods, and nothing moves', /price, not goods/.test(r.view.said) && count(ALICE, GOLD) === 100);
r = stall(ALICE, ['lay', SWORD.toString(16), '0', '9', 'gold', '30']);
yes('  more than she carries is refused', /do not carry that many/.test(r.view.said) && count(ALICE, SWORD) === 1);
r = stall(ALICE, ['find', 'iron', 'ingot']);
yes('S6 Find turns up what a goods price can name', r.view.found.some(function (f) { return f.name === 'Iron Ingot' && f.base === INGOT.toString(16); }));
r = stall(ALICE, ['find', 'gold']);
yes('  never gold', /Nothing goes by that name/.test(r.view.said) && r.view.found.length === 0);
r = stall(ALICE, ['lay', SALT.toString(16), '0', '3', 'goods', INGOT.toString(16), '2']);
const saltLine = r.view.lines.filter(function (l) { return l.what === 'Salt Pile'; })[0];
yes('S7 she lays out 3 salt at 2 Iron Ingot a piece: a price in goods', !!saltLine && saltLine.count === 3 &&
    saltLine.words === '2 Iron Ingot' && count(ALICE, SALT) === 2);
const swordLine = r.view.lines.filter(function (l) { return l.what === 'Iron Sword'; })[0];

// -------------------------------------------------------------------- selling
r = stall(BOB, ['open', 'whiterun-1']);
yes('S8 Bob sees the wares and their prices, and that the keeper is here, with no keeper controls',
    r.view.lines.length === 2 && r.view.keeperHere === true && !r.view.mine && !('pack' in r.view) && r.view.packGold === 100);
r = stall(BOB, ['buy', String(swordLine.n), '1']);
yes('S9 Bob buys a sword: 30 gold from his pack to hers, the sword to him, one off the line',
    /Bought Iron Sword/.test(r.view.said) && count(BOB, GOLD) === 70 && count(ALICE, GOLD) === 130 && count(BOB, SWORD) === 1 &&
    r.view.lines.filter(function (l) { return l.n === swordLine.n; })[0].count === 1);
yes('  and she is told in her chat what sold', (said[ALICE.pid] || []).some(function (m) { return /Iron Sword sold for 30 gold/.test(m); }));
r = stall(BOB, ['buy', String(saltLine.n), '1']);
yes('S10 a goods price he cannot pay is refused, and nothing moves', /do not carry 2 Iron Ingot/.test(r.view.said) &&
    count(BOB, INGOT) === 1 && count(BOB, SALT) === 0);
refs[BOB.a].inventory.entries.push({ baseId: INGOT, count: 4 });
r = stall(BOB, ['buy', String(saltLine.n), '2']);
yes('S11 with the ingots he buys 2 salt for 4 Iron Ingot, and the ingots go to her',
    count(BOB, SALT) === 2 && count(BOB, INGOT) === 1 && count(ALICE, INGOT) === 4 && count(BOB, GOLD) === 70);
r = stall(BOB, ['buy', String(saltLine.n), '5']);
yes('  more than is on the stall is refused', /not that many/.test(r.view.said) && count(BOB, SALT) === 2);
refs[BOB.a].inventory.entries = refs[BOB.a].inventory.entries.map(function (e) { return e.baseId === GOLD ? { baseId: GOLD, count: 10 } : e; });
r = stall(BOB, ['buy', String(swordLine.n), '1']);
yes('  more gold than he carries is refused, and nothing moves', /do not carry 30 gold/.test(r.view.said) &&
    count(BOB, GOLD) === 10 && count(ALICE, GOLD) === 130);
refs[BOB.a].inventory.entries = refs[BOB.a].inventory.entries.map(function (e) { return e.baseId === GOLD ? { baseId: GOLD, count: 70 } : e; });

// ------------------------------------------------- only while the keeper is there
standAt(ALICE, 'away');
r = stall(BOB, ['open', 'whiterun-1']);
yes('S12 with Alice walked away, Bob sees the keeper is away', r.view.keeperHere === false);
r = stall(BOB, ['buy', String(swordLine.n), '1']);
yes('  and nothing is sold, and nothing moves', /keeper is not at the stall/.test(r.view.said) && count(BOB, GOLD) === 70 &&
    count(BOB, SWORD) === 1);
standAt(ALICE, 'stall');
online = online.filter(function (a) { return a !== ALICE.a; });
r = stall(BOB, ['buy', String(swordLine.n), '1']);
yes('  nor when she is out of the world, even standing there', /keeper is not at the stall/.test(r.view.said) && count(BOB, SWORD) === 1);
online.push(ALICE.a);
r = stall(ALICE, ['buy', String(swordLine.n), '1']);
yes('  and she cannot buy from her own stall', /your own stall/.test(r.view.said));

// ------------------------------------------------------- her prices, her goods
r = stall(ALICE, ['price', String(swordLine.n), 'goods', INGOT.toString(16), '3']);
yes('S13 she changes a price to goods', r.view.lines.filter(function (l) { return l.n === swordLine.n; })[0].words === '3 Iron Ingot');
r = stall(BOB, ['price', String(swordLine.n), 'gold', '1']);
yes('  and Bob cannot', /not yours/.test(r.view.said));
r = stall(ALICE, ['back', String(swordLine.n), '1']);
yes('S14 she takes a sword back into her pack', count(ALICE, SWORD) === 2 && !r.view.lines.some(function (l) { return l.n === swordLine.n; }));

// -------------------------------------------------------- the panel on its own
function drawn(view) {
  function el() {
    return { innerHTML: '', className: '', style: {}, children: [], value: '', id: '',
             appendChild: function (c) { this.children.push(c); return c; },
             addEventListener: function () { },
             querySelector: function (q) { if (!this._q) { this._q = {}; } if (!this._q[q]) { this._q[q] = el(); } return this._q[q]; },
             querySelectorAll: function () { return []; },
             getAttribute: function () { return null; } };
  }
  const doc = { head: el(), body: el(), createElement: function () { return el(); },
                getElementById: function () { return null; }, addEventListener: function () { } };
  const sent = [];
  const win = { skyrimPlatform: { sendMessage: function () { } }, thornswoodNet: { say: function (l) { sent.push(l); } } };
  vm.runInNewContext(page, { window: win, document: doc, console: console, JSON: JSON, Date: Date });
  win.thornswoodStall.setData(view);
  const p = doc.body.children[0];
  return { html: p ? p.querySelector('.body').innerHTML : '', title: p ? p.querySelector('h2').innerHTML : '', win: win, sent: sent };
}
const pk = drawn(stall(ALICE, ['open', 'whiterun-1']).view);
yes('S15 the keeper\'s panel has her lines, Set price, Take back, Lay it out, Find and Let the stall go',
    /Salt Pile/.test(pk.html) && /data-do="price"/.test(pk.html) && /data-do="back"/.test(pk.html) &&
    /data-do="lay"/.test(pk.html) && /data-do="find"/.test(pk.html) && /data-do="letgo"/.test(pk.html) && /your stall/.test(pk.title));
const pb = drawn(stall(BOB, ['open', 'whiterun-1']).view);
yes('  Bob\'s has the wares and Buy, and nothing of hers to change', /data-do="buy"/.test(pb.html) && !/data-do="price"/.test(pb.html) &&
    !/data-do="end"/.test(pb.html) && /its keeper is here/.test(pb.title));
standAt(ALICE, 'away');
const pa = drawn(stall(BOB, ['open', 'whiterun-1']).view);
yes('  and with her away, Buy is greyed and the panel says why', /disabled/.test(pa.html) && /nothing is sold until they are/.test(pa.html));
standAt(ALICE, 'stall');
const ps = drawn(stall(STEWARD, ['open', 'whiterun-1']).view);
yes('  Whiterun\'s steward gets End this claim', /data-do="end"/.test(ps.html));
standAt(STEWARD, 'riften');
const pr = drawn(stall(STEWARD, ['open', 'riften-1']).view);
yes('  a free stall offers Claim', /data-do="claim"/.test(pr.html) && /nobody keeps it/.test(pr.title));
standAt(STEWARD, 'stall');
pk.win.thornswoodStall.close();
yes('  closing the panel tells the server', pk.sent.indexOf('/stall close') >= 0 && !pk.win.thornswoodStall.isOpen());

// --------------------------------------------------------- across a restart
const before = JSON.stringify(bookFile());
W = makeWorld();
r = stall(BOB, ['open', 'whiterun-1']);
yes('S16 after a restart the stall is still hers, with what is on it', JSON.stringify(bookFile()) === before &&
    r.view.lines.length === 1 && r.view.keeperHere === true);

// ------------------------------------------------------------------- the lapse
clock.t += 15 * DAY;
r = stall(BOB, ['open', 'whiterun-1']);
const wbox = W.__thornswoodProperty.dropbox().whiterun;
yes('S17 after 14 days away her stall lapses: it is free, and the salt went to Whiterun\'s drop box for her',
    r.view.free === true && !!wbox && wbox.items.some(function (it) { return it.baseId === SALT && it.count === 1 && it.by === ALICE.pid && it.kind === 'stall'; }) &&
    bookFile().out.length === 0);
const hers = inDir(function () { return W.__thornswoodProperty.boxView(ALICE.a, ALICE.pid, 'whiterun', '', false); });
yes('  she sees it at the box as hers, to take back', (hers.rows || []).some(function (x) { return x.mine && x.what === 'Salt Pile'; }));
const bobs = inDir(function () { return W.__thornswoodProperty.boxView(BOB.a, BOB.pid, 'whiterun', '', false); });
yes('  and Bob does not', !(bobs.rows || []).some(function (x) { return x.what === 'Salt Pile'; }));
const receipt = wbox.items.filter(function (it) { return it.kind === 'stall'; })[0].receipt;
yes('  and the box keeps the receipt, so the same piece never goes in twice',
    inDir(function () { return W.__thornswoodProperty.boxKeep('whiterun', { baseId: SALT }, 1, receipt, null, 'again'); }) === true &&
    W.__thornswoodProperty.dropbox().whiterun.items.filter(function (it) { return it.receipt === receipt; }).length === 1);

// ------------------------------------------------ a steward, staff, and letting go
stall(ALICE, ['open', 'whiterun-1']);
stall(ALICE, ['claim']);
stall(ALICE, ['lay', SWORD.toString(16), '0', '1', 'gold', '5']);
r = stall(BOB, ['end']);
yes('S18 Bob cannot end her keeping', /Only this hold's steward, or staff/.test(r.view.said) && !r.view.free);
stall(STEWARD, ['open', 'whiterun-1']);
r = stall(STEWARD, ['end']);
yes('S19 Whiterun\'s steward ends it: the stall is free and the sword is in the box for her',
    r.view.free === true && W.__thornswoodProperty.dropbox().whiterun.items.some(function (it) { return it.baseId === SWORD && it.by === ALICE.pid; }) &&
    staffLog.length === 0);
stall(ALICE, ['open', 'whiterun-1']);
stall(ALICE, ['claim']);
stall(SAM, ['open', 'whiterun-1']);
r = stall(SAM, ['end']);
yes('S20 staff end it too, and the press is in the staff log as an eviction, with the stall',
    r.view.free === true && staffLog.length === 1 && staffLog[0][0] === 'evict' && staffLog[0][3] === ALICE.pid &&
    /market stall Whiterun market/.test(staffLog[0][5]));
stall(ALICE, ['open', 'whiterun-1']);
stall(ALICE, ['claim']);
r = stall(ALICE, ['letgo']);
yes('S21 she lets it go, and it is free', r.view.free === true && /You let the stall go/.test(r.view.said));

// ------------------------------------------------ a pack that will not take it
stall(ALICE, ['claim']);
stall(ALICE, ['lay', SALT.toString(16), '0', '1', 'gold', '5']);
const line5 = bookFile().stalls['whiterun-1'].lines[0].n;
const g0 = { bob: count(BOB, GOLD), alice: count(ALICE, GOLD), salt: count(BOB, SALT) };
failPack = { id: ALICE.a, skip: 0 };
r = stall(BOB, ['buy', String(line5), '1']);
failPack = null;
yes('S24 when the keeper\'s pack will not take the price, nothing is sold and nothing moves',
    /could not take the price, so nothing was sold/.test(r.view.said) && count(BOB, GOLD) === g0.bob && count(ALICE, GOLD) === g0.alice &&
    count(BOB, SALT) === g0.salt && bookFile().stalls['whiterun-1'].lines.length === 1 && bookFile().stalls['whiterun-1'].lines[0].count === 1);
const boxWas = ((W.__thornswoodProperty.dropbox().whiterun || {}).items || []).length;
failPack = { id: BOB.a, skip: 1 };
r = stall(BOB, ['buy', String(line5), '1']);
failPack = null;
const boxNow = W.__thornswoodProperty.dropbox().whiterun.items;
yes('S25 when the buyer\'s pack will not take the piece, the sale stands and it waits in the hold\'s drop box for him',
    /in this hold's drop box for you/.test(r.view.said) && count(BOB, GOLD) === g0.bob - 5 && count(ALICE, GOLD) === g0.alice + 5 &&
    count(BOB, SALT) === g0.salt && bookFile().stalls['whiterun-1'].lines.length === 0 && bookFile().out.length === 0 &&
    boxNow.length === boxWas + 1 && boxNow[boxNow.length - 1].by === BOB.pid && boxNow[boxNow.length - 1].baseId === SALT &&
    boxNow[boxNow.length - 1].count === 1);
stall(ALICE, ['letgo']);

// --------------------------------------------------------------- the release
stall(ALICE, ['claim']);
stall(ALICE, ['lay', SWORD.toString(16), '0', '1', 'gold', '5']);
const boxBefore = W.__thornswoodProperty.dropbox().whiterun.items.length;
W = makeWorld({ actor: function (x) { return x === ALICE.a; }, profile: function (x) { return x === ALICE.pid; } });
yes('S22 when she is deleted her stall ends at the next start, and the sword is in the box with no name on it',
    !!released && released.saved && released.counts.stalls === 1 && !bookFile().stalls['whiterun-1'] &&
    W.__thornswoodProperty.dropbox().whiterun.items.length === boxBefore + 1 &&
    W.__thornswoodProperty.dropbox().whiterun.items.slice(-1)[0].by === 0);

// ------------------------------------------------------- a book that does not read
fs.writeFileSync(path.join(dir, 'private', 'market-stalls.json'), '{"version":1,"state":{"stalls":{"x":7},"out":[],"next":1}}');
W = makeWorld();
yes('S23 a book that does not read opens no stall, and nothing is written over it', !W.__thornswoodStalls &&
    fs.readFileSync(path.join(dir, 'private', 'market-stalls.json'), 'utf8').indexOf('"x":7') > 0);

// --------------------------------------------------------------------- the wiring
const words = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
const pwords = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
const WL = words ? new Function('return ' + words[1])() : [];
const PL = pwords ? new Function('return ' + pwords[1])() : [];
yes('W1 the server answers /stall, and nobody is told to type it', WL.indexOf('/stall') >= 0 && PL.indexOf('/stall') < 0 &&
    /if \(word === '\/stall'\)/.test(gm));
yes('W2 the panel is sent only to the person who opened it',
    /mp\.makeProperty\(VIEW, \{\s*isVisibleByOwner: true, isVisibleByNeighbors: false/.test(stallBlock));
yes('W3 the release has a stalls part, and the server log\'s list is the same',
    /var PARTS = \[[^\]]*'stalls'[^\]]*\]/.test(gm) &&
    require(path.join(REPO_DIR, 'scripts', 'vps', 'Server-Log.js')).RELEASE_PARTS.indexOf('stalls') >= 0);
yes('W4 the front plugin loads the panel, lets its focus go, and puts the line up at a stall',
    /'thornswood-stall\.js'/.test(front) && /stall: 'thornswoodStall'/.test(front) && /what === 'stall:opened'/.test(front) &&
    /what === 'stall:closed'/.test(front) && /return lockKeyRef\(\) \|\| stallNow\(\);/.test(front) && /verb: 'stall open'/.test(front));
const table = JSON.parse(read(path.join(REPO_DIR, 'game', 'data', 'market-stalls.json'))).stalls;
const spots = /const STALL_SPOTS = \[([\s\S]*?)\];/.exec(front);
yes('W5 the front plugin\'s stalls are the table\'s, row for row', !!spots &&
    (spots[1].match(/\[/g) || []).length === table.length &&
    table.every(function (t) { return spots[1].indexOf(JSON.stringify(t.id)) >= 0; }));
let bundled = '';
try { bundled = require('child_process').execFileSync(process.execPath, [path.join(REPO_DIR, 'scripts', 'dev', 'Build-MarketStallsGamemode.js'), '--check'], { encoding: 'utf8' }); }
catch (e) { bundled = String(e.stdout || '') + String(e.message || ''); }
yes('W6 the bundle in the gamemode and both tables are not stale', /^PASS/.test(bundled));

done();
