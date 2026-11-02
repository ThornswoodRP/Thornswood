'use strict';
/*
  test-2554-board-posts.js

  #2554. Patrick, 15 Oct 2026: "the Jobs and Notices need a title and a
  body". What he decided:
    - A Make a post button, apart from the list and pinned to the bottom of
      the board, so the posts above it scroll. It asks for a title, the body,
      and Job or Notice; a job also asks for its reward.
    - Posting a job takes the reward and the board fee together. The reward
      is held for whoever does the job, the way a haul's pay is held, and the
      fee is the board's. A notice takes only the fee.
    - The title is up to 60 characters and the body up to 600, both
      required, and the server checks both, not only the page.
    - The list shows each post's title, Job or Notice, a job's reward, who
      posted it and when. Opening a post shows its body, and a job's Take.
    - Fees (20 and 30), the take down rules and letters are unchanged.

  The real property block of game/gamemode.js runs here over a pretend
  engine and a register in a temporary folder, the way
  tests/test-502-guard-board.js runs it, and the real board page runs in a
  small stand-in document. The line the page sends is fed to the server, so
  what one writes is what the other reads. Read only apart from its own
  temporary folder.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('./gamemode-tables.js').joined(read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js')));
const page = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-board.js'));
const journal = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-journal.js'));
const voice = read(path.join(REPO_DIR, 'voice', 'voice-server.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e), false); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('the property block is in the gamemode', !!propBlock);
if (!propBlock) { done(); process.exit(1); }

const clock = { t: Date.UTC(2026, 9, 15, 19, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
const GOLD = 0x0000000F;

const GUARD = { a: 0xff000101, pid: 101, name: 'Hrongar' };   // a guard of Whiterun
const ALICE = { a: 0xff000303, pid: 303, name: 'Alice' };     // posts
const BOB = { a: 0xff000404, pid: 404, name: 'Bob' };         // takes jobs
const CAROL = { a: 0xff000505, pid: 505, name: 'Carol' };     // posts, then goes away
const POOR = { a: 0xff000606, pid: 606, name: 'Poor' };       // 40 gold
const PEOPLE = [GUARD, ALICE, BOB, CAROL, POOR];

/* ------------------------------------------------------- the server, running */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2554-posts-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
// An office is one character's (#2551, Patrick, 16 Oct): the law register
// names the character that holds each office for its account. A profile the
// door ties to no account is an account of its own, 'p:<profile>'.
fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: { 'guard:whiterun': { 'p:101': { pid: 101, name: 'Hrongar' } } } }));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
  claims: {}, boxes: {},
  // A board a steward placed, so the seeding leaves it where it is.
  boards: { whiterun: { cell: '3c:Skyrim.esm', pos: [0, 0, 0], where: 'Whiterun', placed: true } },
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
                pos: [50, 0, 0], inventory: { entries: [{ baseId: GOLD, count: p === POOR ? 40 : 500 }] } };
});
let online = PEOPLE.map(function (p) { return p.a; });
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
const box = {
  console: { log: function () { } },
  require: require, mp: mp, Date: FakeDate,
  BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
  idOf: function (d) { const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(String(d || '')); return m ? parseInt(m[1], 16) : 0; },
  notify: function (a, m) { toasts.push([a, m]); }, say: function () { },
  guard: function (n, f) { return f; },
  setInterval: function () { return 1; }, clearInterval: function () { },
  log: function () { },
  __thornswoodCharacter: { stateOf: function () { return { prof: 'cook' }; }, writeState: function () { } },
  // Hrongar holds the Guard of Whiterun role (#2551): the role is who guards.
  __thornswoodOffices: function (pid) {
    return { jarl: [], court: [], steward: [], guard: pid === GUARD.pid ? ['whiterun'] : [] };
  }
};
box.globalThis = box;
inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
const W = box.__thornswoodProperty;
yes('the property block runs', !!W && typeof W.command === 'function' && typeof W.haulTick === 'function');
if (!W) { done(); process.exit(1); }

/* A line as the server gets it: dispatch splits it on spaces (gamemode.js). */
function say(p, line) {
  const parts = String(line).trim().split(/\s+/);
  const by = {};
  inDir(function () {
    W.command(parts[0].toLowerCase(), parts, p.a, p.pid, function (pid, m) { (by[pid] = by[pid] || []).push(m); });
  });
  return { mine: (by[p.pid] || []).join(' '), by: by };
}
function gold(p) { return refs[p.a].inventory.entries.reduce(function (s, e) { return s + (e.baseId === GOLD ? e.count : 0); }, 0); }
function list() { return W.notices().whiterun || []; }
function ledger() { return Number(W.funds().whiterun) || 0; }
function panel(p) { let v = null; inDir(function () { v = W.boardPanel(p.a, p.pid); }); return v; }

/* ----------------------------------------------- the page's own two encoders */
const slashBody = new Function(slice(page, '  function slashBody(s) {', '\n  }\n') + '\nreturn slashBody;')();
const slashTitle = new Function(slice(page, '  function slashTitle(s) {', '\n  }\n') + '\nreturn slashTitle;')();

// -------------------------------------------------------------- the lengths
attempt('the lengths', function () {
  yes('L0 the server holds a title to 60 and a body to 600',
      /var POST_TITLE_CHARS = 60;/.test(gm) && /var POST_BODY_CHARS = 600;/.test(gm));
  yes('L0 and the page asks for the same', /var TITLE_CHARS = 60;/.test(page) && /var BODY_CHARS = 600;/.test(page));
  const g0 = gold(ALICE), f0 = ledger();
  let r = say(ALICE, '/notice ' + 'T'.repeat(61) + ' :: a body');
  yes('L1 a 61 character title is refused with a plain line, and nothing is taken: "' + r.mine + '"',
      r.mine === 'A title is up to 60 characters. That one is 61. Nothing was taken.' &&
      gold(ALICE) === g0 && ledger() === f0 && list().length === 0);
  r = say(ALICE, '/notice ' + 'a'.repeat(298) + ' ' + 'b'.repeat(302) + ' :: ok');
  yes('L1 and a body sent as the title does not slip past it', /A title is up to 60/.test(r.mine) && list().length === 0);
  r = say(ALICE, '/notice Lost cat :: ' + 'x'.repeat(601));
  yes('L2 a 601 character body is refused, and nothing is taken: "' + r.mine + '"',
      r.mine === 'What the notice says is up to 600 characters. That is 601. Nothing was taken.' &&
      gold(ALICE) === g0 && list().length === 0);
  r = say(ALICE, '/job 10 Lost cat :: ' + 'x'.repeat(601));
  yes('L2 the same for a job', /What the job says is up to 600 characters\. That is 601\. Nothing was taken\./.test(r.mine) &&
      gold(ALICE) === g0 && list().length === 0);
  r = say(ALICE, '/notice :: the body and no title');
  yes('L3 an empty title is refused: "' + r.mine + '"', r.mine === 'Give the notice a title. Nothing was taken.' &&
      gold(ALICE) === g0 && list().length === 0);
  r = say(ALICE, '/notice');
  yes('L3 and so is nothing at all', r.mine === 'Give the notice a title. Nothing was taken.' && list().length === 0);
  r = say(ALICE, '/notice A title and no body ::');
  yes('L4 an empty body is refused: "' + r.mine + '"', r.mine === 'Say what the notice says. Nothing was taken.' &&
      gold(ALICE) === g0 && list().length === 0);
  r = say(ALICE, '/notice A title and no separator');
  yes('L4 and a line with no :: has no body', r.mine === 'Say what the notice says. Nothing was taken.' && list().length === 0);
  r = say(ALICE, '/job 10 :: a body');
  yes('L4 a job with no title is refused', r.mine === 'Give the job a title. Nothing was taken.' && list().length === 0);
  r = say(ALICE, '/job 10 A job ::');
  yes('L4 and with no body', r.mine === 'Say what the job is. Nothing was taken.' && list().length === 0);

  // At the limits exactly, and a body whose newlines are counted as one each.
  const body600 = ('y'.repeat(99) + '\n').repeat(6);
  r = say(ALICE, '/notice ' + slashTitle('T'.repeat(60)) + ' :: ' + slashBody(body600.slice(0, 600)));
  yes('L5 a 60 character title and a 600 character body with newlines in it go up: "' + r.mine + '"',
      r.mine === 'Your notice is on the board in whiterun. That cost 20 gold.' && list().length === 1 &&
      list()[0].title === 'T'.repeat(60) && list()[0].text === body600.slice(0, 600).trim() &&
      gold(ALICE) === g0 - 20 && ledger() === f0 + 20);
});

// ------------------------------------------------------- what goes over the line
attempt('the line', function () {
  /*
    What somebody writes, sent the way the page sends it and read the way the
    server reads it, comes back as they wrote it: colons, a :: in the title,
    backslashes, a typed \n, and newlines. Runs of spaces are the one thing
    every line loses (dispatch splits on them), so these have single spaces.
  */
  const cases = [
    ['Wanted: the man who stole my goat', 'He is tall.\nHe smells of goat.'],
    ['Room :: to let', 'Ask at the inn: Hulda knows.\n\nTwo rooms.'],
    ['C:\\Path and a \\n typed', 'A backslash \\ and a typed \\n, then a real\nnewline, and :: in the body.'],
    ['Ends with a colon:', ':) starts with one'],
    ['Back\\', 'slash at the end\\']
  ];
  cases.forEach(function (c, i) {
    const before = list().length;
    const r = say(ALICE, '/notice ' + slashTitle(c[0]) + ' :: ' + slashBody(c[1]));
    const n = list()[list().length - 1];
    yes('W' + (i + 1) + ' "' + c[0] + '" and its body come back as written',
        /Your notice is on the board/.test(r.mine) && list().length === before + 1 &&
        n.title === c[0] && n.text === c[1]);
  });
});

// ------------------------------------------------------------- a job's reward
attempt('a job', function () {
  const g0 = gold(ALICE), f0 = ledger(), h0 = W.heldOn('whiterun');
  ['', 'ten', '0', '-5', '1.5', '9007199254740993'].forEach(function (bad) {
    const r = say(ALICE, '/job ' + bad + ' Mend my fence :: The north side.');
    yes('J1 a reward of "' + bad + '" is refused before anything is taken',
        /A job's reward is a whole number of gold, above nothing\. Nothing was taken\.|Give the job a title/.test(r.mine) &&
        gold(ALICE) === g0 && ledger() === f0);
  });
  let r = say(POOR, '/job 15 Carry water :: Ten buckets.');
  yes('J2 a job costs the fee and the reward together, and 40 gold does not buy 45: "' + r.mine + '"',
      r.mine === 'That costs 45 gold, 30 for the board and the 15 reward, and you do not have it. Nothing was taken.' &&
      gold(POOR) === 40);
  r = say(ALICE, '/job 50 Mend my fence :: The north side, before the snow.');
  const at = list().length;
  const job = list()[at - 1];
  yes('J3 posting a job takes the reward and the fee together: "' + r.mine + '"',
      gold(ALICE) === g0 - 80 && ledger() === f0 + 80 && job.job === true && job.pay === 50 &&
      job.title === 'Mend my fence' && job.text === 'The north side, before the snow.' &&
      /That cost 80 gold: 30 for the board, and the 50 reward, held until you say the job is done/.test(r.mine));
  yes('J3 and the reward is held on the ledger, so nothing else can spend it', W.heldOn('whiterun') === h0 + 50);
  r = say(ALICE, '/notice Selling a horse :: A good one.');
  yes('J4 a notice takes only its fee', gold(ALICE) === g0 - 100 && ledger() === f0 + 100 && !list()[at].pay);

  const row = panel(BOB).wall.filter(function (x) { return x.n === at; })[0];
  yes('J5 the wall row has its title, Job, its reward, who and when, and its body for when it is opened',
      !!row && row.title === 'Mend my fence' && row.job === true && row.reward === 50 && row.name === 'Alice' &&
      row.at === clock.t && row.text === 'The north side, before the snow.');

  r = say(BOB, '/job done ' + at);
  yes('J6 only the poster says it is done: "' + r.mine + '"', r.mine === 'Only the person who posted a job says it is done.');
  r = say(ALICE, '/job done ' + at);
  yes('J6 and not before anybody has taken it', r.mine === 'Nobody has taken that job yet.' && gold(BOB) === 500);
  r = say(BOB, '/take ' + at);
  yes('J7 Bob takes it and is told the reward is held: "' + r.mine + '"',
      r.mine === 'You take it: Mend my fence. Go and see Alice about it. The 50 gold reward is held until Alice says it is done.');
  yes('J7 Alice\'s row now offers Pay the reward', panel(ALICE).wall.some(function (x) { return x.n === at && x.mine && x.taken === 'Bob'; }));
  r = say(ALICE, '/unpin ' + at);
  yes('J8 a job somebody took still stays up for its poster', /Bob has taken that job/.test(r.mine) && !list()[at - 1].down);
  r = say(BOB, '/dropjob ' + at);
  yes('J9 handed back, it is open again and the reward is still held',
      !list()[at - 1].taken && list()[at - 1].pay === 50 && W.heldOn('whiterun') === h0 + 50);
  say(BOB, '/take ' + at);
  const fBefore = ledger();
  r = say(ALICE, '/job done ' + at);
  yes('J10 Pay the reward: Bob is paid the whole 50 out of the ledger: "' + r.mine + '"',
      r.mine === 'Done: Mend my fence. Bob is paid the 50 gold reward.' && gold(BOB) === 550 &&
      ledger() === fBefore - 50 && W.heldOn('whiterun') === h0);
  yes('J10 and Bob is told', (r.by[BOB.pid] || []).join(' ') === 'Alice says your job is done: Mend my fence. The 50 gold reward is in your pack.');
  yes('J10 and the job comes down, keeping its number, the fee with the hold',
      !!list()[at - 1].down && list()[at - 1].paid === 50 && list()[at - 1].pay === 0 &&
      !panel(BOB).wall.some(function (x) { return x.n === at; }));
  r = say(ALICE, '/job done ' + at);
  yes('J11 and it is paid once', r.mine === 'That one has been taken down.' && gold(BOB) === 550);
  r = say(ALICE, '/job done 99');
  yes('J11 a number not on the board is refused', r.mine === 'That one is not on the board.');
  r = say(ALICE, '/job done 1');
  yes('J11 and a notice has no reward to pay', r.mine === 'That is not a job with a reward.');
});

// ------------------------------------------------------- taking one down
attempt('take downs', function () {
  const g0 = gold(ALICE), f0 = ledger();
  say(ALICE, '/job 20 Fetch firewood :: Ten logs, split.');
  const at = list().length;
  const r = say(ALICE, '/unpin ' + at);
  yes('T1 the poster takes an untaken job down: the reward comes back, the fee stays: "' + r.mine + '"',
      r.mine === 'You take it down. The 20 gold reward comes back to you. The fee stays with whiterun.' &&
      gold(ALICE) === g0 - 30 && ledger() === f0 + 30 && !!list()[at - 1].down);

  // Carol posts a job, Bob takes it, Carol goes away, a guard takes it down.
  const c0 = gold(CAROL);
  say(CAROL, '/job 40 Guard the gate :: Until the bells.');
  const cat = list().length;
  say(BOB, '/take ' + cat);
  online = online.filter(function (a) { return a !== CAROL.a; });
  const f1 = ledger();
  const g = say(GUARD, '/unpin ' + cat);
  yes('T2 a guard takes Carol\'s taken job down while she is away: the reward is held for her: "' + g.mine + '"',
      g.mine === 'You take Carol\'s job down. The 40 gold reward goes back to them when they are next in the world. The fee stays with whiterun.' &&
      list()[cat - 1].owed === 40 && list()[cat - 1].owedFor === 'job' && ledger() === f1 && W.heldOn('whiterun') >= 40);
  yes('T2 and Bob is told it is off his list', (g.by[BOB.pid] || []).join(' ') ===
      'The job in whiterun you took was taken down by a guard. It is off your list.');
  inDir(function () { W.haulTick(); });
  yes('T3 while Carol is away nothing is handed over', gold(CAROL) === c0 - 70 && ledger() === f1);
  online.push(CAROL.a);
  inDir(function () { W.haulTick(); });
  yes('T4 back in the world, the reward is in her pack and off the ledger, once',
      gold(CAROL) === c0 - 30 && ledger() === f1 - 40 && Number(list()[cat - 1].owed) === 0);
  yes('T4 and she is told why', toasts.some(function (t) {
    return t[0] === CAROL.a && t[1] === 'While you were away, a guard took your job in whiterun down: Guard the gate. ' +
      'The 40 gold reward is back in your pack. The fee stays with whiterun.';
  }));
  inDir(function () { W.haulTick(); });
  yes('T4 a second tick pays nothing more', gold(CAROL) === c0 - 30 && ledger() === f1 - 40);

  // Bob away when Alice says done: the reward waits for him.
  say(ALICE, '/job 25 Sweep the hall :: Twice.');
  const sat = list().length;
  say(BOB, '/take ' + sat);
  online = online.filter(function (a) { return a !== BOB.a; });
  const b0 = gold(BOB), f2 = ledger();
  const d = say(ALICE, '/job done ' + sat);
  yes('T5 Bob is away: the reward is held for him: "' + d.mine + '"',
      d.mine === 'Done: Sweep the hall. Bob is away, so the 25 gold reward is held for them until they are next in the world.' &&
      !!list()[sat - 1].down && list()[sat - 1].owed === 25 && list()[sat - 1].owedFor === 'reward' && ledger() === f2);
  online.push(BOB.a);
  inDir(function () { W.haulTick(); });
  yes('T6 back in the world, he has it and is told who said it was done',
      gold(BOB) === b0 + 25 && ledger() === f2 - 25 && toasts.some(function (t) {
        return t[0] === BOB.a && t[1] === 'While you were away, Alice said the job you took in whiterun is done: Sweep the hall. ' +
          'The 25 gold reward is in your pack.';
      }));
});

/* ------------------------------------------------- the page, in a stand-in */
/*
  Enough of a document for the board page: elements made by createElement,
  innerHTML parsed into elements with their attributes, querySelector and
  querySelectorAll by tag, .class and [attribute], getElementById over what
  is in the page, and input listeners.
*/
function standIn() {
  const sent = [];
  const all = [];
  function el(tag) {
    const n = {
      tagName: String(tag).toUpperCase(), attrs: {}, children: [], kids: [], style: {}, value: '', textContent: '',
      className: '', id: '', onclick: null, listeners: {}, _html: '', parent: null,
      appendChild: function (c) { c.parent = this; this.children.push(c); return c; },
      getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      addEventListener: function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      fire: function (t) { (this.listeners[t] || []).forEach(function (f) { f.call(n, { target: n }); }); },
      click: function () { if (this.onclick) { this.onclick.call(this, { target: this }); } },
      querySelectorAll: function (sel) {
        const out = [];
        const test = matcher(sel);
        (function walk(list) {
          list.forEach(function (k) { if (test(k)) { out.push(k); } walk(k.children.concat(k.kids)); });
        })(this.children.concat(this.kids));
        return out;
      },
      querySelector: function (sel) { return this.querySelectorAll(sel)[0] || null; }
    };
    Object.defineProperty(n, 'innerHTML', {
      get: function () { return this._html; },
      set: function (h) {
        this._html = String(h);
        this.kids = [];
        const re = /<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>/gi;
        let m;
        while ((m = re.exec(this._html))) {
          const k = el(m[1]);
          const ar = /([a-z-]+)(?:="([^"]*)")?/gi;
          let a;
          while ((a = ar.exec(m[2]))) {
            k.attrs[a[1]] = a[2] == null ? '' : a[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
          }
          k.id = k.attrs.id || '';
          k.className = k.attrs['class'] || '';
          k.parent = this;
          this.kids.push(k);
        }
      }
    });
    all.push(n);
    return n;
  }
  function matcher(sel) {
    const s = String(sel).trim().split(/\s+/).pop();
    const m = /^([a-z0-9]*)(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i.exec(s);
    return function (k) {
      if (!m) { return false; }
      if (m[1] && k.tagName !== m[1].toUpperCase()) { return false; }
      if (m[2] && String(k.className).split(/\s+/).indexOf(m[2]) < 0) { return false; }
      if (m[3] && k.getAttribute(m[3]) === null) { return false; }
      if (m[3] && m[4] !== undefined && k.getAttribute(m[3]) !== m[4]) { return false; }
      return true;
    };
  }
  const doc = {
    head: el('head'), body: el('body'),
    createElement: function (t) { return el(t); },
    addEventListener: function () { },
    getElementById: function (id) {
      // Only what is in the page now: the newest element with that id under the body.
      let hit = null;
      (function walk(list) {
        list.forEach(function (k) { if (k.id === id) { hit = k; } walk(k.children.concat(k.kids)); });
      })(doc.body.children);
      return hit;
    }
  };
  const win = { skyrimPlatform: { sendMessage: function () { } },
                thornswoodNet: { say: function (line) { sent.push(line); return true; } } };
  vm.runInNewContext(page, { window: win, document: doc, console: console, isFinite: isFinite, JSON: JSON, Date: FakeDate });
  return { win: win, doc: doc, sent: sent, board: win.thornswoodBoard,
           root: function () { return doc.body.children[0]; },
           body: function () { return doc.body.children[0].querySelector('.body'); },
           find: function (sel) { return doc.body.children[0].querySelectorAll(sel); },
           byId: function (id) { return doc.getElementById(id); } };
}

attempt('the page', function () {
  let parses = true;
  try { new vm.Script(page); new vm.Script(journal); } catch (e) { parses = false; }
  yes('P0 the board page and the journal parse', parses);

  const p = standIn();
  const view = panel(BOB);
  p.board.setData({ board: view });
  p.board.open();
  const html = p.body().innerHTML;
  // When is this machine's clock, so the hour is whatever 7 PM UTC is here.
  yes('P1 the list shows a post\'s title, Notice, who and when, on a 12-hour clock',
      html.indexOf('Selling a horse') > 0 && /Notice, Alice, \d{1,2}:00 (AM|PM), 1[56] Oct/.test(html));
  yes('P1 and not its body until it is opened', html.indexOf('A good one.') < 0);

  // An open job on the wall, not Bob's.
  say(ALICE, '/job 35 Find my ring :: Silver, lost by the well.');
  const jn = list().length;
  p.board.setData({ board: panel(BOB) });
  let h = p.body().innerHTML;
  yes('P2 a job shows Job and its reward in the list', h.indexOf('Find my ring') > 0 && h.indexOf('Job, 35 gold reward, Alice') > 0);
  yes('P2 and Take is not on the closed row', h.indexOf('data-do="take" data-n="' + jn + '"') < 0);
  const readBtn = p.find('[data-key="w' + jn + '"]').filter(function (k) { return k.tagName === 'BUTTON'; })[0];
  yes('P3 the row has Read', !!readBtn && /Read/.test(h));
  readBtn.click();
  h = p.body().innerHTML;
  yes('P3 Read opens it: its body, and Take', h.indexOf('Silver, lost by the well.') > 0 &&
      h.indexOf('data-do="take" data-n="' + jn + '"') > 0 && h.indexOf('>Hide<') > 0);
  p.find('[data-do="take"]')[0].click();
  yes('P3 and Take sends the line that takes it', p.sent[p.sent.length - 1] === '/take ' + jn);

  // Make a post sits in the foot, apart from the list.
  const make = p.root().querySelector('.make');
  yes('P4 Make a post is in the foot, not in the list',
      !!make && make.parent === p.root() && p.root()._html.indexOf('<div class="foot"><button class="go make" data-do="compose">Make a post</button>') > 0 &&
      p.body().innerHTML.indexOf('Make a post') < 0);
  yes('P4 and the two one line boxes are gone', page.indexOf('placeholder="the notice"') < 0 && page.indexOf('placeholder="the job"') < 0);
  make.click();
  const title = p.byId('ts-board-title');
  const text = p.byId('ts-board-text');
  const reward = p.byId('ts-board-reward');
  yes('P5 pressing it asks for a title, held to 60, and the body, held to 600, and Job or Notice',
      !!title && title.getAttribute('maxlength') === '60' && !!text && text.tagName === 'TEXTAREA' &&
      text.getAttribute('maxlength') === '600' && p.find('[data-kind="job"]').length === 1 &&
      p.find('[data-kind="notice"]').length === 1);
  yes('P5 a notice does not ask for a reward', !!reward && p.byId('ts-board-rewardline').style.display === 'none');
  p.find('[data-do="send"]')[0].click();
  yes('P6 an empty title is said on the page and nothing is sent',
      p.byId('ts-board-said').textContent === 'Give it a title.' && p.sent.length === 1);
  p.find('[data-kind="job"]')[0].click();
  yes('P7 a job asks for its reward', p.byId('ts-board-rewardline').style.display === '' &&
      /30 gold for the board, and the reward/.test(p.byId('ts-board-cost').textContent));
  title.value = 'Wanted: a smith :: now'; title.fire('input');
  text.value = 'Iron, and lots.\nAsk at C:\\forge.'; text.fire('input');
  // A push from the server while the form is up does not rebuild it.
  p.board.setData({ board: panel(BOB) });
  yes('P8 a push while the form is up leaves what was typed where it is',
      p.byId('ts-board-title') === title && p.byId('ts-board-text') === text);
  reward.value = 'ten'; reward.fire('input');
  p.find('[data-do="send"]')[0].click();
  yes('P9 a reward that is not a whole number is said on the page', /whole number of gold/.test(p.byId('ts-board-said').textContent) &&
      p.sent.length === 1);
  reward.value = '60'; reward.fire('input');
  p.find('[data-do="send"]')[0].click();
  const line = p.sent[p.sent.length - 1];
  yes('P10 Post it sends the job with its reward, title and body on one line',
      p.sent.length === 2 && line.indexOf('/job 60 ') === 0 && line.indexOf('\n') < 0);
  const g0 = gold(BOB);
  const r = say(BOB, line);
  const made = list()[list().length - 1];
  yes('P11 the server reads back what was written: "' + r.mine + '"',
      made.title === 'Wanted: a smith :: now' && made.text === 'Iron, and lots.\nAsk at C:\\forge.' && made.pay === 60 &&
      gold(BOB) === g0 - 90);
  yes('P12 until it is up the form stays', !!p.byId('ts-board-title'));
  p.board.setData({ board: panel(BOB) });
  yes('P12 once it is on the wall, the form closes and the list is back',
      !p.byId('ts-board-title') && p.body().innerHTML.indexOf('Wanted: a smith :: now') > 0);

  // The poster's own taken job offers Pay the reward, which sends /job done.
  say(ALICE, '/take ' + list().length);
  p.board.setData({ board: panel(BOB) });
  const paid = p.find('[data-do="paid"]')[0];
  yes('P13 Bob\'s taken job offers Pay the reward', !!paid && paid.getAttribute('data-n') === String(list().length));
  paid.click();
  yes('P13 and it sends the line that pays it', p.sent[p.sent.length - 1] === '/job done ' + list().length);
});

// ---------------------------------------------------------- J and the socket
attempt('J and the socket', function () {
  const draw = slice(journal, '  function drawBoards(main) {', '\n  }\n');
  yes('S1 J shows a post\'s title, Job or Notice, a job\'s reward, who and when, and its body',
      !!draw && /esc\(row\.title\)/.test(draw) && /gold reward/.test(draw) && /postedAt\(row\.at\)/.test(draw) &&
      /esc\(row\.text\)/.test(draw));
  const cap = Number((/const COMMAND_CHARS = (\d+);/.exec(voice) || [])[1]);
  const longest = ('/job ' + Number.MAX_SAFE_INTEGER + ' ' + slashTitle(':'.repeat(60)) + ' :: ' + slashBody('\\'.repeat(600))).length;
  yes('S2 the longest post the page can send (' + longest + ') fits a command line on the chat socket (' + cap + ')',
      longest <= cap && /\.slice\(0, COMMAND_CHARS\)/.test(voice));
  yes('S3 and a line said to the room still keeps 400', /const SAID_CHARS = 400;/.test(voice) &&
      /long\.slice\(0, SAID_CHARS\)/.test(voice));
});

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
done();
