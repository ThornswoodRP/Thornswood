'use strict';
/*
  test-502-guard-board.js

  #502. Patrick, 11 October: guards have "the ability to remove posts from a
  notice board ... only wiithin their own hold".

  The real property block runs over a pretend engine with the ten boards it
  seeds, a guard of Whiterun and a guard of Riften (each by their Discord role
  since #2551, which the door hands the block as __thornswoodOffices),
  and a Whiterun board already carrying a notice, a taken job, two letters
  and a haul. It checks:
    - the board panel says guard only to a guard of that board's hold, and the
      real board page then draws Take down on every post, and only then;
    - a guard of Whiterun takes each kind of post down at Whiterun's board;
      the fee stays with the hold, held gold goes back to its poster (held for
      them while they are away, and handed over when they are back), and
      whoever had taken it is told;
    - a guard of Riften, at Whiterun's board, is anybody;
    - the server log names the guard, the hold and the post, and never a
      letter's words.
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('./gamemode-tables.js').joined(read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js')));
const page = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-board.js'));
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
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

const clock = { t: Date.UTC(2026, 9, 12, 7, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
const GOLD = 0x0000000F;

const GUARD_W = { a: 0xff000101, pid: 101, name: 'Hrongar' };   // a guard of Whiterun
const GUARD_R = { a: 0xff000202, pid: 202, name: 'Maul' };      // a guard of Riften
const ALICE = { a: 0xff000303, pid: 303, name: 'Alice' };       // posts
const BOB = { a: 0xff000404, pid: 404, name: 'Bob' };           // took Alice's job
const CAROL = { a: 0xff000505, pid: 505, name: 'Carol' };       // posted a letter, then went away
const PEOPLE = [GUARD_W, GUARD_R, ALICE, BOB, CAROL];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-502-board-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
// An office is one character's (#2551, Patrick, 16 Oct): the law register
// names the character that holds each office for its account. A profile the
// door ties to no account is an account of its own, 'p:<profile>'.
fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: { 'guard:whiterun': { 'p:101': { pid: 101, name: 'Hrongar' } }, 'guard:riften': { 'p:202': { pid: 202, name: 'Maul' } } } }));
const T = clock.t - 3600000;
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
  claims: {}, boxes: {},
  // Two boards a steward placed, so the seeding leaves them where they are.
  boards: {
    whiterun: { cell: '3c:Skyrim.esm', pos: [0, 0, 0], where: 'Whiterun', placed: true },
    riften: { cell: '3c:Skyrim.esm', pos: [100000, 0, 0], where: 'Riften', placed: true }
  },
  // A notice, a job with its 25 reward (#2554), two letters and a haul.
  funds: { whiterun: 20 + 55 + 35 + 35 + 80, riften: 20 },
  notices: {
    whiterun: [
      { by: ALICE.pid, name: 'Alice', title: 'Lost: a grey cat', text: 'Grey, answers to Tib.', at: T, job: false, taken: 0 },
      { by: ALICE.pid, name: 'Alice', title: 'Mend my fence', text: 'The north side, before the snow.', at: T, job: true,
        pay: 25, taken: BOB.pid, takenName: 'Bob' },
      { by: ALICE.pid, name: 'Alice', text: 'the words of a letter', at: T, job: true, letter: true, to: 'Lydia', pay: 15, taken: 0 },
      { by: CAROL.pid, name: 'Carol', text: 'another sealed letter', at: T, job: true, letter: true, to: 'Ysolda', pay: 15, taken: 0 },
      { by: ALICE.pid, name: 'Alice', text: 'ten crates of mead', at: T, job: true, haul: true, dest: 'riften', pay: 50, taken: 0 }
    ],
    riften: [
      { by: ALICE.pid, name: 'Alice', title: 'Selling a horse', text: 'A good one.', at: T, job: false, taken: 0 }
    ]
  }
}));
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

const refs = {};
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: 'nowhere',
                pos: [0, 0, 0], inventory: { entries: [{ baseId: GOLD, count: 100 }] } };
});
let online = PEOPLE.filter(function (p) { return p !== CAROL; }).map(function (p) { return p.a; });
const logged = [];
const toasts = [];
const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
    if (!refs[id]) { throw new Error('no reference ' + id); }
    const v = refs[id][key];
    return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  },
  set: function (id, key, v) {
    if (!refs[id]) { refs[id] = {}; }
    refs[id][key] = JSON.parse(JSON.stringify(v));
  },
  getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
  lookupEspmRecordById: function () { return null; },
  getNeighborsByPosition: function () { return []; }
};
let tick = null;
const box = {
  console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
  require: require, mp: mp, Date: FakeDate,
  BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
  idOf: function (d) { const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(String(d || '')); return m ? parseInt(m[1], 16) : 0; },
  notify: function (a, m) { toasts.push([a, m]); }, say: function () { },
  guard: function (n, f) { return f; },
  setInterval: function (f) { if (!tick) { tick = f; } return 1; }, clearInterval: function () { },
  log: function () { },
  __thornswoodCharacter: { stateOf: function () { return { prof: 'cook' }; }, writeState: function () { } },
  // The Guard of Whiterun and Guard of Riften roles (#2551).
  __thornswoodOffices: function (pid) {
    return { jarl: [], court: [], steward: [],
             guard: pid === GUARD_W.pid ? ['whiterun'] : (pid === GUARD_R.pid ? ['riften'] : []) };
  }
};
box.globalThis = box;
inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
const W = box.__thornswoodProperty;
yes('the property block runs, with the guards', !!W && typeof W.boardPanel === 'function' && W.isGuard(101, 'whiterun'));
if (!W) { done(); }
yes('the block hands out the haulTick its timer runs', typeof W.haulTick === 'function' && typeof tick === 'function');

const boards = W.boards();
function standAt(p, hold) {
  const b = boards[hold];
  refs[p.a].worldOrCellDesc = b.cell;
  refs[p.a].pos = [b.pos[0] + 50, b.pos[1], b.pos[2]];
}
PEOPLE.forEach(function (p) { standAt(p, 'whiterun'); });
yes('the Whiterun and Riften boards are seeded', !!boards.whiterun && !!boards.riften);

function word(p, w, args) {
  const by = {};
  inDir(function () {
    W.command(w, [w].concat(args || []), p.a, p.pid, function (pid, m) { (by[pid] = by[pid] || []).push(m); });
  });
  return { mine: (by[p.pid] || []).join(' '), by: by };
}
function panel(p) { let v = null; inDir(function () { v = W.boardPanel(p.a, p.pid); }); return v; }
function gold(p) { return refs[p.a].inventory.entries.reduce(function (s, e) { return s + (e.baseId === GOLD ? e.count : 0); }, 0); }
function list(hold) { return W.notices()[hold]; }

// ------------------------------------------------------------ the panel
const pW = panel(GUARD_W), pR = panel(GUARD_R), pA = panel(ALICE);
yes('B1 at Whiterun\'s board the panel says guard to Whiterun\'s guard only',
    pW.guard === true && pR.guard === false && pA.guard === false);
standAt(GUARD_R, 'riften');
yes('B2 and at Riften\'s board, to Riften\'s guard', panel(GUARD_R).guard === true);
standAt(GUARD_R, 'whiterun');

/* The real board page, in a stand-in document, drawing what the server sent. */
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
  const win = { skyrimPlatform: { sendMessage: function () { } } };
  vm.runInNewContext(page, { window: win, document: doc, console: console, isFinite: isFinite, JSON: JSON });
  win.thornswoodBoard.setData({ board: view });
  win.thornswoodBoard.open();
  return doc.body.children[0] ? doc.body.children[0].querySelector('.body').innerHTML : '';
}
let html = '';
try { html = drawn(pW); } catch (e) { console.log('      threw: ' + e); }
const downs = (html.match(/data-do="unpin"/g) || []).length;
yes('B3 the board page draws Take down on every post for the guard (' + downs + ' of ' + pW.wall.length + ')',
    pW.wall.length === 5 && downs === 5);
let htmlA = '';
try { htmlA = drawn(pA); } catch (e) { console.log('      threw: ' + e); }
const downsA = (htmlA.match(/data-do="unpin"/g) || []).length;
yes('B4 and for anybody else only on what is theirs to take down (' + downsA + ' for Alice)', downsA === 3);

// --------------------------------------------------- a guard of another hold
let r = word(GUARD_R, '/unpin', ['1']);
yes('O1 a guard of Riften at Whiterun\'s board cannot take Alice\'s notice down: "' + r.mine + '"',
    r.mine === 'That is not yours to take down.' && !list('whiterun')[0].down);

// ------------------------------------------------- Whiterun's guard, each kind
const fundsBefore = W.funds().whiterun;
r = word(GUARD_W, '/unpin', ['1']);
yes('N1 a notice comes down: "' + r.mine + '"', r.mine === 'You take Alice\'s notice down. The fee stays with whiterun.' &&
    !!list('whiterun')[0].down && list('whiterun')[0].downBy === GUARD_W.pid);
yes('N2 Alice is told', (r.by[ALICE.pid] || []).join(' ') === 'A guard took your notice in whiterun down. The fee stays with whiterun.');
yes('N3 the fee stays with the hold', W.funds().whiterun === fundsBefore);
yes('N4 the log names the guard, the hold and the post', logged.some(function (l) {
  return l.indexOf('law: a guard of whiterun (Hrongar, profile 101) took down Alice\'s notice 1 in whiterun: Lost: a grey cat: Grey, answers to Tib.') >= 0;
}));

const aliceGold0 = gold(ALICE);
r = word(GUARD_W, '/unpin', ['2']);
yes('J1 a job somebody took comes down too, and its reward goes back to Alice (#2554): "' + r.mine + '"',
    r.mine === 'You take Alice\'s job down. The 25 gold reward goes back to them. The fee stays with whiterun.' &&
    !!list('whiterun')[1].down && gold(ALICE) === aliceGold0 + 25 && W.funds().whiterun === fundsBefore - 25);
yes('J1 and Alice is told it is back in her pack',
    (r.by[ALICE.pid] || []).join(' ') === 'A guard took your job in whiterun down. The 25 gold reward is back in your pack. The fee stays with whiterun.');
yes('J2 and Bob, who took it, is told it is off his list',
    (r.by[BOB.pid] || []).join(' ') === 'The job in whiterun you took was taken down by a guard. It is off your list.');
yes('J3 it is off his list', W.notices().whiterun.length === 5 &&
    !list('whiterun').some(function (n) { return n.job && Number(n.taken) === BOB.pid && !n.down; }));

const aliceGold = gold(ALICE);
r = word(GUARD_W, '/unpin', ['3']);
yes('L1 a letter comes down and its 15 goes back to Alice: "' + r.mine + '"',
    r.mine === 'You take Alice\'s letter down. The 15 gold for the courier goes back to them. The fee stays with whiterun.' &&
    gold(ALICE) === aliceGold + 15 && W.funds().whiterun === fundsBefore - 40 && !!list('whiterun')[2].down);
yes('L2 Alice is told it is back in her pack',
    (r.by[ALICE.pid] || []).join(' ') === 'A guard took your letter in whiterun down. The 15 gold for the courier is back in your pack. The fee stays with whiterun.');
yes('L3 the log does not carry the letter\'s words', logged.some(function (l) {
  return /law: a guard of whiterun .* took down Alice's letter 3 in whiterun$/.test(l);
}) && !logged.some(function (l) { return l.indexOf('the words of a letter') >= 0; }));

r = word(GUARD_W, '/unpin', ['4']);
const carols = list('whiterun')[3];
yes('A1 Carol is away, so her letter\'s 15 is held for her: "' + r.mine + '"',
    r.mine === 'You take Carol\'s letter down. The 15 gold for the courier goes back to them when they are next in the world. The fee stays with whiterun.' &&
    !!carols.down && carols.owed === 15 && Number(carols.owedTo) === CAROL.pid && carols.owedFor === 'letter' &&
    W.funds().whiterun === fundsBefore - 40);
yes('A2 and the ledger keeps it held, so nothing else spends it', W.heldOn('whiterun') >= 15 + 50);
online.push(CAROL.a);
inDir(function () { W.haulTick(); });
yes('A3 when Carol is back in the world it is in her pack and off the ledger',
    gold(CAROL) === 115 && Number(list('whiterun')[3].owed) === 0 && W.funds().whiterun === fundsBefore - 55);
yes('A4 and she is told why', toasts.some(function (t) {
  return t[0] === CAROL.a && t[1] === 'While you were away, a guard took your letter for Ysolda in whiterun down. The 15 gold for the courier is back in your pack. The fee stays with whiterun.';
}));

const aliceGold2 = gold(ALICE);
r = word(GUARD_W, '/unpin', ['5']);
yes('H1 a haul comes down and its pay goes back to Alice: "' + r.mine + '"',
    /You take Alice's haul to riften down\. The 50 gold pay goes back to them\. The fee stays with whiterun\./.test(r.mine) &&
    gold(ALICE) === aliceGold2 + 50 && !!list('whiterun')[4].down);
yes('H2 Alice is told a guard did it', (r.by[ALICE.pid] || []).join(' ').indexOf('A guard took your haul to riften down.') === 0);
yes('H3 and the log says a guard', logged.some(function (l) { return /a guard took down a haul to riften in whiterun/.test(l); }));

// --------------------------------------------------------- their own hold
r = word(GUARD_W, '/unpin', ['1']);
yes('W1 at Whiterun\'s board a post already down stays down', r.mine === 'That one is already down.');
standAt(GUARD_W, 'riften');
r = word(GUARD_W, '/unpin', ['1']);
yes('W2 at Riften\'s board Whiterun\'s guard is anybody: "' + r.mine + '"',
    r.mine === 'That is not yours to take down.' && !list('riften')[0].down);
standAt(GUARD_R, 'riften');
r = word(GUARD_R, '/unpin', ['1']);
yes('W3 and Riften\'s guard takes it down there', r.mine === 'You take Alice\'s notice down. The fee stays with riften.' &&
    !!list('riften')[0].down);

done();
