'use strict';
/*
  test-2298-dropbox.js

      node tests/test-2298-dropbox.js

  #2298, the hold's drop box on the notice board. Patrick, 12 October:
    - Anybody may take back what they put in, rent included (then the rent is
      owed again); that hold's officers (its Court, its Guards, its Jarl and
      its Steward, 15 October, #2551) may take anything; anybody else is
      refused, an officer of another hold included.
    - A person sees only what they put in, gold too, never the box's total;
      only officers see everything, and only they get Records.
    - Carriage and ferry fares go in as real gold, by themselves.
    - Notice and job fees never go in: they stay a record.
    - Every deposit and take is recorded with the character's name.
    - A Trading Company drop off left for somebody away is handed out by a
      steward.
    - Trade ship cargo nobody collected goes in under the recipient's name,
      put in by the ship, and a steward hands it out (#511, 22 Oct).

  The real property block runs over a pretend engine, with Whiterun's and
  Riften's boards placed, a guard of each, Whiterun's Steward and Court,
  Riften's Steward, both Jarls (every office by its Discord role, which the
  door hands the block as __thornswoodOffices), and people with gold, a claim
  with rent owed, and a sword. Each rule is driven
  through the same /dropbox lines the box's panel sends, and the real panel
  page draws what the server sent.
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('./gamemode-tables.js').joined(read(path.join(REPO_DIR, 'game', 'gamemode.js')));
const page = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-box.js'));
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('the property block is in the gamemode', !!propBlock);
if (!propBlock) { done(); }

const clock = { t: Date.UTC(2026, 9, 12, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
const GOLD = 0x0000000F;
const SWORD = 0x00012EB7;

const ALICE = { a: 0xff000303, pid: 303, name: 'Alice' };        // pays, owes rent
const BOB = { a: 0xff000404, pid: 404, name: 'Bob' };            // anybody
const CAROL = { a: 0xff000505, pid: 505, name: 'Carol' };        // a courier, leaves a sword for Dagny
const GUARD_W = { a: 0xff000101, pid: 101, name: 'Hrongar' };    // a guard of Whiterun
const GUARD_R = { a: 0xff000202, pid: 202, name: 'Maul' };       // a guard of Riften
const STEWARD = { a: 0xff000606, pid: 606, name: 'Proventus' };  // Steward of Whiterun
const JARL_W = { a: 0xff000707, pid: 707, name: 'Balgruuf' };    // Jarl of Whiterun
const JARL_R = { a: 0xff000808, pid: 808, name: 'Laila' };       // Jarl of Riften
const COURT_W = { a: 0xff000909, pid: 909, name: 'Irileth' };    // on Whiterun's Court (#2551)
const STEWARD_R = { a: 0xff000919, pid: 919, name: 'Anuriel' };  // Steward of Riften (#2551)
const PEOPLE = [ALICE, BOB, CAROL, GUARD_W, GUARD_R, STEWARD, JARL_W, JARL_R, COURT_W, STEWARD_R];
// Every office is a Discord role (#2551), read through the door.
const ROLES = {
  101: { guard: ['whiterun'] }, 202: { guard: ['riften'] }, 606: { steward: ['whiterun'] },
  707: { jarl: ['whiterun'] }, 808: { jarl: ['riften'] }, 909: { court: ['whiterun'] }, 919: { steward: ['riften'] }
};
function officesOf(pid) {
  const o = ROLES[pid] || {};
  return { jarl: o.jarl || [], court: o.court || [], steward: o.steward || [], guard: o.guard || [] };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2298-box-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
// An office is one character's (#2551, Patrick, 16 Oct): the law register
// names the character that holds each office for its account. A profile the
// door ties to no account is an account of its own, 'p:<profile>'.
fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: { 'guard:whiterun': { 'p:101': { pid: 101, name: 'Hrongar' } }, 'guard:riften': { 'p:202': { pid: 202, name: 'Maul' } }, 'steward:whiterun': { 'p:606': { pid: 606, name: 'Proventus' } }, 'jarl:whiterun': { 'p:707': { pid: 707, name: 'Balgruuf' } }, 'jarl:riften': { 'p:808': { pid: 808, name: 'Laila' } }, 'court:whiterun': { 'p:909': { pid: 909, name: 'Irileth' } }, 'steward:riften': { 'p:919': { pid: 919, name: 'Anuriel' } } } }));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
  claims: {
    '1234:Skyrim.esm': { by: ALICE.pid, name: 'Alice', at: clock.t - 86400000,
                         rent: { amount: 15, everyDays: 7, since: clock.t - 3600000, owed: 15 } }
  },
  boxes: {},
  boards: {
    whiterun: { cell: '3c:Skyrim.esm', pos: [0, 0, 0], where: 'Whiterun', placed: true },
    riften: { cell: '3c:Skyrim.esm', pos: [100000, 0, 0], where: 'Riften', placed: true }
  },
  funds: {}, notices: {}
}));
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
refs[CAROL.a].inventory.entries.push({ baseId: SWORD, count: 2 });
refs[ALICE.a].inventory.entries.push({ baseId: SWORD, count: 1, worn: true });
const shown = {};
function makeMp() {
  return {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return PEOPLE.map(function (p) { return p.a; }); }
      if (!refs[id]) { throw new Error('no reference ' + id); }
      const v = refs[id][key];
      return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    },
    set: function (id, key, v) {
      if (key === 'thornswoodBoxView') { shown[id] = JSON.parse(JSON.stringify(v)); return; }
      if (!refs[id]) { refs[id] = {}; }
      refs[id][key] = JSON.parse(JSON.stringify(v));
    },
    getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
    lookupEspmRecordById: function () { return null; },
    getNeighborsByPosition: function () { return []; }
  };
}
const logged = [];
function makeBlock() {
  const box = {
    console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
    require: require, mp: makeMp(), Date: FakeDate,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
    // The two name tables the gamemode's top level has; one name is enough here.
    ITEM_NAMES: { 'iron sword': ['Iron Sword', '12eb7:Skyrim.esm'] },
    idOf: function (d) { const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(String(d || '')); return m ? parseInt(m[1], 16) : 0; },
    notify: function () { }, say: function () { },
    guard: function (n, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { },
    __thornswoodOffices: officesOf,
    __thornswoodCharacter: {
      stateOf: function () { return { prof: 'cook' }; },
      writeState: function () { }
    }
  };
  box.globalThis = box;
  inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
  return box.__thornswoodProperty;
}
let W = makeBlock();
yes('the property block runs, with the drop box in it', !!W && typeof W.dropboxCmd === 'function' &&
    typeof W.boxFare === 'function');
if (!W) { done(); }

function at(p, hold) {
  refs[p.a].pos = hold === 'riften' ? [100050, 0, 0] : [50, 0, 0];
}
function box(p, args) {
  let said = [];
  inDir(function () {
    W.command('/dropbox', ['/dropbox'].concat(args || []), p.a, p.pid, function (pid, m) { said.push(m); });
  });
  return { view: shown[p.a], said: said.join(' ') };
}
function gold(p) {
  return refs[p.a].inventory.entries.reduce(function (s, e) { return s + (e.baseId === GOLD ? e.count : 0); }, 0);
}
function swords(p) {
  return refs[p.a].inventory.entries.reduce(function (s, e) { return s + (e.baseId === SWORD ? e.count : 0); }, 0);
}
function rentOwed() { return W.claims()['1234:Skyrim.esm'].rent.owed; }
function rowOf(view, pred) { return (view.rows || []).filter(pred)[0]; }

// ------------------------------------------------------------- open, and where
let r = box(ALICE, ['open']);
yes('E on the box opens its panel, at the board', !!r.view && r.view.open === true && r.view.hold === 'whiterun' &&
    r.view.where === 'Whiterun');
yes('  and it shows what Alice carries to put in: her gold, and not her worn sword',
    r.view.packGold === 100 && (r.view.pack || []).every(function (x) { return x.what !== 'Iron Sword'; }));
refs[BOB.a].pos = [5000, 0, 0];
r = box(BOB, ['open']);
yes('away from any board, the box does not open', /Stand at a hold's notice board/.test(r.said) && !shown[BOB.a]);
at(BOB, 'whiterun');

// ----------------------------------------------------------------- gold in, with rent
r = box(ALICE, ['gold', '40']);
yes('D1 Alice puts in 40 gold: it leaves her pack', gold(ALICE) === 60 && /You put 40 gold in the box/.test(r.view.said));
yes('  and pays her 15 of rent first', rentOwed() === 0 && /15 of it pays your rent/.test(r.view.said));
yes('  and she sees her row and her own gold, and not the box\'s total',
    r.view.rows.length === 1 && r.view.rows[0].mine && r.view.mineGold === 40 && !('allGold' in r.view) &&
    !('records' in r.view));
r = box(ALICE, ['gold', 'lots']);
yes('  a share that is not a whole number is refused, and nothing moves', /whole number/.test(r.view.said) && gold(ALICE) === 60);
r = box(ALICE, ['gold', '500']);
yes('  and more than she carries is refused', /do not have 500 gold/.test(r.view.said) && gold(ALICE) === 60);

// --------------------------------------------------------------- fees never go in
// A post has a title and a body (#2554): the title, ::, then the body.
inDir(function () { W.command('/notice', ['/notice', 'Lost', 'cat', '::', 'Grey,', 'answers', 'to', 'Tib.'], ALICE.a, ALICE.pid, function () { }); });
yes('D2 a notice fee is taken and kept as a record (funds), not put in the box', gold(ALICE) === 40 &&
    W.funds().whiterun === 20 && W.dropbox().whiterun.items.length === 1);

// ---------------------------------------------------------------- the fare
yes('D3 a carriage fare goes into the hold\'s box by itself, as gold', inDir(function () { return W.boxFare('whiterun', 20, 'Whiterun to Riverwood'); }) === true);
r = box(GUARD_W, ['open']);
const fareRow = rowOf(r.view, function (x) { return x.kind === 'fare'; });
yes('  Whiterun\'s guard sees it, and the whole gold in the box (40 and 20)', !!fareRow && fareRow.count === 20 &&
    r.view.allGold === 60 && r.view.officer === true);
r = box(ALICE, ['open']);
yes('  Alice does not: she sees only her 40', r.view.rows.length === 1 && r.view.mineGold === 40 &&
    !rowOf(r.view, function (x) { return x.kind === 'fare'; }));
yes('  and the fare is no fee: the fee record is still 20', W.funds().whiterun === 20);
yes('  a fare to a hold that is not one of the ten, or of nothing, is refused',
    W.boxFare('skyrim', 5, 'x') === false && W.boxFare('whiterun', 0, 'x') === false);

// ---------------------------------------------------------- who may take what
const aliceRow = rowOf(box(ALICE, ['open']).view, function (x) { return x.mine; });
r = box(BOB, ['open']);
yes('D4 Bob sees none of it', r.view.rows.length === 0 && r.view.mineGold === 0 && !('allGold' in r.view));
r = box(BOB, ['take', String(aliceRow.n)]);
yes('  and taking Alice\'s gold is refused, with nothing moved', /not yours to take/.test(r.view.said) &&
    gold(BOB) === 100 && W.dropbox().whiterun.items.some(function (x) { return x.n === aliceRow.n && x.count === 40; }));
r = box(BOB, ['records']);
yes('  and he gets no records', /Only this hold's officers/.test(r.view.said) && !('records' in r.view));

r = box(ALICE, ['take', String(aliceRow.n), '25']);
yes('D5 Alice takes 25 of her own back', gold(ALICE) === 65 && /You took 25 Gold out/.test(r.view.said));
yes('  and the 15 of rent it paid is owed again', rentOwed() === 15 && /15 gold of rent is owed again/.test(r.view.said));
yes('  and her row shows the 15 left', r.view.mineGold === 15);

at(GUARD_R, 'whiterun');
r = box(GUARD_R, ['take', String(aliceRow.n)]);
yes('D6 Riften\'s guard, at Whiterun\'s box, is anybody: refused', /not yours to take/.test(r.view.said) && gold(GUARD_R) === 100);
r = box(JARL_R, ['take', String(aliceRow.n)]);
yes('  so is Riften\'s Jarl', /not yours to take/.test(r.view.said) && gold(JARL_R) === 100);
r = box(STEWARD_R, ['take', String(aliceRow.n)]);
yes('  and Riften\'s Steward: a Steward is an officer only at their own hold\'s box (#2551)',
    /not yours to take/.test(r.view.said) && gold(STEWARD_R) === 100);
r = box(GUARD_W, ['take', String(aliceRow.n), '5']);
yes('  Whiterun\'s guard may take Alice\'s gold', gold(GUARD_W) === 105 && /You took 5 Gold out/.test(r.view.said));
yes('  and the rent stays as it is: an officer taking it is not Alice taking it back', rentOwed() === 15);
r = box(JARL_W, ['take', String(fareRow.n), '10']);
yes('  Whiterun\'s Jarl may take from the fares', gold(JARL_W) === 110);
r = box(COURT_W, ['take', String(fareRow.n), '5']);
yes('  and so may Whiterun\'s Court (#2551)', gold(COURT_W) === 105 && /You took 5 Gold out/.test(r.view.said));
r = box(STEWARD, ['take', String(aliceRow.n)]);
yes('  and a steward may take the rest of Alice\'s', gold(STEWARD) === 110 &&
    !W.dropbox().whiterun.items.some(function (x) { return x.n === aliceRow.n; }));
r = box(ALICE, ['open']);
yes('  after which Alice sees nothing of hers left', r.view.rows.length === 0 && r.view.mineGold === 0);

// ------------------------------------------- a drop off for somebody who was away
r = box(CAROL, ['open']);
const swordSlot = (r.view.pack || []).filter(function (x) { return x.what === 'Iron Sword'; })[0];
yes('D7 Carol\'s pack offers her two swords by name', !!swordSlot && swordSlot.count === 2);
r = box(CAROL, ['leave', String(swordSlot.slot), '1', 'Dagny']);
yes('  she leaves one for Dagny, who is not here', swords(CAROL) === 1 && /You left Iron Sword in the box for Dagny/.test(r.view.said));
const left = rowOf(r.view, function (x) { return x.forName === 'Dagny'; });
yes('  and her view shows it, for Dagny', !!left && left.what === 'Iron Sword' && left.count === 1);
r = box(CAROL, ['leave', String(swordSlot.slot), '1', '']);
yes('  without a name it is refused', /Say who it is for/.test(r.view.said) && swords(CAROL) === 1);
r = box(BOB, ['take', String(left.n)]);
yes('  Bob may not take it', /not yours to take/.test(r.view.said) && swords(BOB) === 0);
r = box(STEWARD, ['take', String(left.n)]);
yes('  the steward takes it out to hand to Dagny', swords(STEWARD) === 1);

// ------------------------------------------------------------------ the records
r = box(GUARD_W, ['records']);
const recs = r.view.records || [];
function rec(re) { return recs.some(function (x) { return re.test(x.who + ' ' + x.act + ' ' + x.count + ' ' + x.what + ' ' + x.forName + ' ' + x.by + ' ' + x.note); }); }
yes('D8 Records lists every deposit by name: Alice\'s 40, the fare, Carol\'s sword for Dagny',
    rec(/^Alice in 40 Gold/) && rec(/^A fare in 20 Gold/) && rec(/^Carol in 1 Iron Sword Dagny/));
yes('  and every take by name, with whose it was',
    rec(/^Alice out 25 Gold .* Alice 15 of it rent, owed again/) && rec(/^Hrongar out 5 Gold .*Alice/) &&
    rec(/^Balgruuf out 10 Gold .*fares/) && rec(/^Proventus out 1 Iron Sword Dagny Carol/));
yes('  each with its time', recs.every(function (x) { return x.at === clock.t; }));
yes('  newest first', recs.length >= 6 && recs[0].act === 'out' && recs[recs.length - 1].who === 'Alice');

// --------------------------------------------------------- kept across a restart
const before = JSON.stringify(W.dropbox());
W = makeBlock();
yes('D9 after a restart the box holds what it held, and its records',
    JSON.stringify(W.dropbox()) === before && W.dropbox().whiterun.log.length === recs.length);

// --------------------------------------------------- the panel draws what was sent
function drawn(view) {
  function el() {
    return { innerHTML: '', className: '', style: {}, children: [], value: '',
             appendChild: function (c) { this.children.push(c); return c; },
             addEventListener: function () { },
             querySelector: function (q) {
               if (!this._q) { this._q = {}; }
               if (!this._q[q]) { this._q[q] = el(); }
               return this._q[q];
             },
             querySelectorAll: function () { return []; },
             getAttribute: function () { return null; } };
  }
  const doc = { head: el(), body: el(), createElement: function () { return el(); },
                getElementById: function () { return null; }, addEventListener: function () { } };
  const sent = [];
  const win = { skyrimPlatform: { sendMessage: function () { } }, thornswoodNet: { say: function (l) { sent.push(l); } } };
  vm.runInNewContext(page, { window: win, document: doc, console: console, isFinite: isFinite, JSON: JSON, Date: Date });
  win.thornswoodBox.setData(view);
  return { html: doc.body.children[0] ? doc.body.children[0].querySelector('.body').innerHTML : '',
           title: doc.body.children[0] ? doc.body.children[0].querySelector('h2').innerHTML : '', win: win };
}
box(ALICE, ['gold', '7']);
const pa = drawn(box(ALICE, ['open']).view);
yes('D10 the panel shows Alice her own gold and a Take back, and no Records',
    /Take back/.test(pa.html) && /Your gold in the box: 7/.test(pa.html) && !/data-do="records"/.test(pa.html) &&
    !/gold in it/.test(pa.title));
const pg = drawn(box(GUARD_W, ['open']).view);
yes('  and Whiterun\'s guard everything, with the total and a Records button',
    /put in by Alice/.test(pg.html) && /data-do="records"/.test(pg.html) && /gold in it/.test(pg.title));
const pb = drawn(box(BOB, ['open']).view);
yes('  and Bob nothing of anybody else\'s', /Nothing of yours/.test(pb.html) && !/Alice/.test(pb.html));
yes('  the panel closes on open false', (function () { pa.win.thornswoodBox.setData({ open: false }); return !pa.win.thornswoodBox.isOpen(); })());

// ------------------------------------------- cargo nobody collected off a ship
// #511, Patrick 22 Oct 2026 (B): after the days at the dock it goes into that
// port's hold box under the recipient's name, put in by the ship.
const shipN = inDir(function () { return W.boxShipped('whiterun', { baseId: SWORD, count: 2, worn: true }, 'Dagny', 'Whiterun docks, off ship-1'); });
const shipItem = W.dropbox().whiterun.items.filter(function (x) { return x.n === shipN; })[0];
yes('D13 cargo nobody collected goes in as a row of its own, for the recipient, put in by the ship',
    shipN > 0 && !!shipItem && shipItem.kind === 'shipped' && shipItem.by === 0 && shipItem.forName === 'Dagny' &&
    shipItem.count === 2 && shipItem.entry.count === undefined && shipItem.entry.worn === undefined && shipItem.what === 'Iron Sword');
const boxWas = JSON.stringify(W.dropbox());
yes('  a hold not of the ten, no name, a name too long, no count, or gold, is refused and changes nothing',
    inDir(function () {
      return W.boxShipped('skyrim', { baseId: SWORD, count: 1 }, 'Dagny', 'x') === 0 &&
        W.boxShipped('whiterun', { baseId: SWORD, count: 1 }, '  ', 'x') === 0 &&
        W.boxShipped('whiterun', { baseId: SWORD, count: 1 }, new Array(62).join('a'), 'x') === 0 &&
        W.boxShipped('whiterun', { baseId: SWORD, count: 0 }, 'Dagny', 'x') === 0 &&
        W.boxShipped('whiterun', { baseId: GOLD, count: 5 }, 'Dagny', 'x') === 0;
    }) && JSON.stringify(W.dropbox()) === boxWas);
r = box(BOB, ['open']);
yes('  Bob does not see it, and may not take it', !rowOf(r.view, function (x) { return x.n === shipN; }) &&
    /not yours to take/.test(box(BOB, ['take', String(shipN)]).view.said) && swords(BOB) === 0);
r = box(STEWARD, ['open']);
const shipRow = rowOf(r.view, function (x) { return x.n === shipN; });
yes('  the steward sees it, from the ship, for Dagny', !!shipRow && shipRow.who === 'Whiterun docks, off ship-1' && shipRow.forName === 'Dagny' && shipRow.kind === 'shipped');
const stewardSwords = swords(STEWARD);
box(STEWARD, ['take', String(shipN)]);
yes('  and takes it out to hand to Dagny', swords(STEWARD) === stewardSwords + 2 && !W.dropbox().whiterun.items.some(function (x) { return x.n === shipN; }));
r = box(GUARD_W, ['records']);
yes('  and the records say where it came from', (r.view.records || []).some(function (x) { return x.who === 'Whiterun docks, off ship-1' && x.act === 'in' && x.forName === 'Dagny' && /Not collected/.test(x.note || ''); }));

// ------------------------------------------------------------------ the wiring
const words = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
const pwords = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
const WL = words ? new Function('return ' + words[1])() : [];
const PL = pwords ? new Function('return ' + pwords[1])() : [];
yes('D11 the server answers /dropbox, and nobody is told to type it',
    WL.indexOf('/dropbox') >= 0 && PL.indexOf('/dropbox') < 0);
yes('  the server never sends the box\'s contents to anybody but the one who opened it',
    /mp\.makeProperty\(BOX_VIEW_PROPERTY, \{\s*isVisibleByOwner: true, isVisibleByNeighbors: false/.test(gm));
const front = read(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'));
yes('  the front plugin loads the box\'s panel and lets its focus go', /'thornswood-box\.js'/.test(front) &&
    /box: 'thornswoodBox'/.test(front) && /what === 'box:opened'/.test(front) && /what === 'box:closed'/.test(front));
yes('  and E on the box is the server\'s to answer: the client presses nothing (#2516)',
    front.indexOf('function boxPress(') < 0 && gm.indexOf('propBoard.boardActivated(refrId, casterRefrId)') > 0);

// ------------------------------------------------------ the box beside the board
{
  // The server stands the box (#2516): boxOffset is BOX_AT turned with the board.
  const p0 = W.boxOffset(0);
  const p90 = W.boxOffset(90);
  yes('D12 the box stands at the right post of a board facing north, on the shelf',
      Math.abs(p0[0] - (-134.52)) < 0.01 && Math.abs(p0[1] - 4) < 0.01 && Math.abs(p0[2] - 80) < 0.01);
  // Turned a quarter east, the board's right (its -x, seen from the front at +y) is north.
  yes('  and turns with the board: facing east it is to the north of it, up the same',
      Math.abs(p90[0] - 4) < 0.01 && Math.abs(p90[1] - 134.52) < 0.01 && Math.abs(p90[2] - 80) < 0.01);
  const AT = /var BOX_AT = \[([^\]]+)\];/.exec(gm);
  const mesh = read(path.join(REPO_DIR, 'scripts', 'mods', 'Build-NoticeBoard.py'));
  yes('  where the mesh builder says the box stands', /box.{0,2}s origin stands at/.test(mesh) && !!AT &&
      AT[1].replace(/\s/g, '') === '-134.52,4.0,80.0');
}

done();
