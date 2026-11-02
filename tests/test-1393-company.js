// test-1393-company.js
//
// #1393. The Free Skyrim Trading Company, as docs/systems/trading-company.md,
// gold.md and property.md have it.
//
// Patrick, 4 Oct: no chat commands for anything people do. A haul is sent
// and confirmed on the notice board panel, whose buttons send /haul lines
// nobody is told to type, and a sale is the trade panel's Buy for the
// company. These checks drive the lines the panels send.
//
// A haul is a job on a board with a pay and a destination hold. Posting it
// takes the 30 job fee and the pay in full onto the posting hold's ledger.
// At the destination's board the poster or a steward presses Confirm: the
// company keeps a tenth of the pay, rounded down, nothing under 10, and the
// hauler is handed the rest out of the ledger. The ledger keeps
// the fee and the tenth. An ordinary job is not a haul: its reward (#2554) is
// paid by its poster on its own board, and a haul's Confirm pays it nothing
// (tests/test-2554-board-posts.js has the reward). The hauler's /dropjob, the poster's /unpin before anybody has
// taken it, or a steward's, hands the pay back and keeps the fee. Somebody
// paid who is away is paid the next time they are in the world, and the gold
// stays held on the ledger until then.
//
// The ledger can go down, through withdraw, and never below what is still
// held for open letters (#1374), open hauls and hauls owed to somebody away.
//
// A company sale: a worker the company has taken on (a Discord role, the
// application) opens an ordinary trade, presses Buy for the company, and puts
// up the price the two of them agree. The seller's things leave the world.
// The worker takes 10%, another 10% is destroyed, the seller receives the
// rest. Under 10 gold neither cut is taken.
//
// The real functions, lifted out of the property block, over the real social
// and trade blocks and the chat block's real /yes branch, on a pretend engine.
// A second boot over the same register is a restart. Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const siteFiles = require('./site-files');
const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(path.join(REPO, p), 'utf8').split(CR).join(''); };
const gm = process.env.GM ? fs.readFileSync(process.env.GM, 'utf8').split(CR).join('') : read('game/gamemode.js');

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
  process.exit(fail ? 1 : 0);
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const prop = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
const SOCIAL = slice(gm, '// ==== thornswood social:', '// ==== end thornswood social ====');
const TRADE = slice(gm, '// ==== thornswood trade ====', '// ==== end thornswood trade ====');
const YES_BRANCH = (function () {
  const a = gm.indexOf("    if (word === '/friend' || word === '/party' || word === '/mute' ||");
  const b = a < 0 ? -1 : gm.indexOf("    if (word === '/rest') {", a);
  return (a < 0 || b < 0) ? null : gm.slice(a, b);
})();
yes('the property, social and trade blocks and the /yes branch are in the gamemode',
    !!prop && !!SOCIAL && !!TRADE && !!YES_BRANCH);
if (!prop || !SOCIAL || !TRADE || !YES_BRANCH) { done(); }

/* One function out of the property block, by name, once. */
function fn(name) {
  const head = '\n  function ' + name + '(';
  const a = prop.indexOf(head);
  if (a < 0 || prop.indexOf(head, a + 1) >= 0) { return null; }
  const b = prop.indexOf('\n  }\n', a + 1);
  return b < 0 ? null : prop.slice(a + 1, b + 4);
}

const NAMES = ['takeGold', 'payOut', 'payHeld', 'sealed', 'nameIs', 'postWords', 'post', 'board', 'take',
               'jobsOf', 'dropJob', 'takedown', 'unpin', 'postLetter', 'deliver', 'letterReach',
               'boardHere', 'nearestBoard', 'wallOf', 'boardPanel', 'boardsView', 'moveBoard', 'command',
               'noticeHolds', 'heldOn', 'mayWithdraw', 'withdraw',
               'haulTenth', 'haulText', 'haulCmd', 'postHaul', 'confirmHaul', 'handHaul', 'haulTick', 'cancelHaul',
               'saleCuts', 'inCompany',
               'personName', 'profileOf', 'onlineActorOf'];
const lifted = {};
const missing = [];
NAMES.forEach(function (n) { lifted[n] = fn(n); if (!lifted[n]) { missing.push(n); } });
yes('every piece of the haul, the ledger and the sale is in the property block, once' +
    (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);

const fees = slice(prop, '  var NOTICE_FEE = ', 'var LETTER_REACH = 700;');
const HAUL_HOW = slice(prop, '  var HAUL_HOW = ', ';\n');
const ledger = slice(prop, '  var LEDGER_HOLDS = [', '\n  }\n');
const seeding = (function () {
  const a = prop.indexOf('  var BOARD_REACH = 400;');
  const b = prop.indexOf('  /** The hold whose board somebody is standing at', a);
  return (a < 0 || b < 0) ? null : prop.slice(a, b);
})();
yes('the fees, the ten ledgers with deposit, and the board seeding are in the property block',
    !!fees && !!ledger && ledger.indexOf('function deposit(') > 0 && !!seeding && !!HAUL_HOW);
const chargenLine = gm.split('\n').find(function (l) { return l.indexOf('const CHARGEN = ') === 0; });
const PASSAGES = chargenLine ? JSON.parse(chargenLine.slice('const CHARGEN = '.length).replace(/;$/, '')).towns : null;
yes('the chargen town table reads', !!PASSAGES);

function num(re) { const m = re.exec(prop); return m ? Number(m[1]) : NaN; }
const JOB_FEE = num(/var JOB_FEE = (\d+);/);
// The haul cut and the sale cuts are the company's terms now (#512, #2695), read
// by the company terms block, which every sandbox here is handed.
const COMPANY = require('./fixtures/company-block').companyApi(gm);
const HAUL_FROM = COMPANY.terms().haulCutFrom;
const SALE_FROM = COMPANY.terms().saleCutFrom;
yes('the job fee is 30, and the company\'s tenth and the sale\'s cuts both start at 10 gold',
    JOB_FEE === 30 && HAUL_FROM === 10 && SALE_FROM === 10);
if (missing.length || !fees || !ledger || !seeding || !PASSAGES || HAUL_FROM !== 10 || SALE_FROM !== 10) { done(); }

const GOLD = 15;
const SWORD = 0x12eb7;
const PELT = 0x3ad52;
const TAMRIEL = '3c:Skyrim.esm';
// Whiterun's and Riften's boards stand inside their walled cities (#2516).
const WHITERUN_WORLD = '1a26f:Skyrim.esm';
const RIFTEN_WORLD = '16bb4:Skyrim.esm';
const WHITERUN = [23139.4, -7891.7, -3494.4];
const NAMES_OF = {};
NAMES_OF[SWORD] = 'Iron Sword';
NAMES_OF[PELT] = 'Bear Pelt';

/* The engine: packs, names, places and who is in the world, kept across a restart. */
function world() {
  const people = {};
  const online = [];
  const props = {};
  const w = {
    people: people, online: online,
    add: function (p) {
      people[p.actor] = { pid: p.pid, name: p.name, cell: p.cell || WHITERUN_WORLD, pos: (p.pos || WHITERUN).slice(),
                          pack: [{ baseId: GOLD, count: p.gold }].concat(JSON.parse(JSON.stringify(p.items || []))) };
      if (online.indexOf(p.actor) === -1) { online.push(p.actor); }
      return p;
    },
    leave: function (p) { const i = online.indexOf(p.actor); if (i >= 0) { online.splice(i, 1); } },
    come: function (p) { if (online.indexOf(p.actor) === -1) { online.push(p.actor); } },
    move: function (p, cell, pos) { people[p.actor].cell = cell; people[p.actor].pos = pos.slice(); },
    at: function (p, hold, s) { const b = s.boards[hold]; w.move(p, b.cell, b.pos); },
    gold: function (p) {
      return people[p.actor].pack.reduce(function (s, e) { return s + (e.baseId === GOLD ? e.count : 0); }, 0);
    },
    count: function (p, baseId) {
      return people[p.actor].pack.reduce(function (s, e) { return s + (e.baseId === baseId ? e.count : 0); }, 0);
    },
    mp: {
      makeProperty: function () { },
      lookupEspmRecordById: function (id) {
        return NAMES_OF[id] ? { record: { type: 'WEAP', editorId: NAMES_OF[id].replace(/ /g, ''),
                                          fields: [{ type: 'FULL', data: NAMES_OF[id] }] } } : null;
      },
      get: function (id, key) {
        if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
        const p = people[id];
        if (!p) { return undefined; }
        if (key === 'inventory') { return { entries: JSON.parse(JSON.stringify(p.pack)) }; }
        if (key === 'appearance') { return { name: p.name }; }
        if (key === 'worldOrCellDesc') { return p.cell; }
        if (key === 'pos') { return p.pos.slice(); }
        if (key === 'profileId') { return p.pid; }
        const k = id + ':' + key;
        return Object.prototype.hasOwnProperty.call(props, k) ? JSON.parse(props[k]) : undefined;
      },
      set: function (id, key, v) {
        if (key === 'inventory') { people[id].pack = JSON.parse(JSON.stringify(v.entries)); return; }
        props[id + ':' + key] = JSON.stringify(v);
      }
    }
  };
  return w;
}

/* The real social and trade blocks, in one sandbox over the engine. */
function sandbox(w, roles) {
  const said = [];
  const ctx = {
    mp: w.mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
    isFinite: isFinite, parseInt: parseInt, isNaN: isNaN,
    console: { log: function () { }, error: function () { } },
    guard: function (name, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    notify: function (id, m) { said.push({ id: id, text: m, how: 'notify' }); },
    say: function (id, m) { said.push({ id: id, text: m, how: 'chat' }); },
    log: function () { }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.__thornswoodCompany = require('./fixtures/company-block').companyApi(gm);
  vm.runInContext(SOCIAL, ctx, { filename: 'gamemode.js social' });
  vm.runInContext(require('./fixtures/ordinary-quest-items') + TRADE, ctx, { filename: 'gamemode.js trade' });
  ctx.__thornswoodIsCompany = function (pid) { return (roles.company || []).indexOf(pid) !== -1; };
  ctx.__thornswoodIsAdmin = function (pid) { return (roles.admin || []).indexOf(pid) !== -1; };
  ctx.said = said;
  return ctx;
}

/* One boot of the board over a register. A restart is a second boot over the same register. */
function boot(reg, w, opts) {
  opts = opts || {};
  const ctx = sandbox(w, opts);
  const body = [
    'var boxes = {};',
    'var funds = loadPart("funds", {});',
    'var notices = loadPart("notices", {});',
    'var GOLD_ID = ' + GOLD + ';',
    'var haulShort = {};',
    'var boardReads = {};',
    HAUL_HOW,
    fees,
    ledger,
    seeding,
    'function save() { reg.funds = JSON.parse(JSON.stringify(funds)); ' +
    'reg.notices = JSON.parse(JSON.stringify(notices)); reg.boards = JSON.parse(JSON.stringify(boards)); reg.saves = (reg.saves || 0) + 1; }',
    'function refreshPanel() { }',
    // Nobody guards these boards; a guard's take down (#502) is
    // tests/test-502-guard-board.js. Nobody is a Jarl here either, and the
    // stewards given are stewards of every board here (#2551, a steward is
    // of one hold: tests/test-2551-hold-offices.js).
    'function isGuard() { return false; }',
    'function isJarlOf() { return false; }',
    'function isStewardOf(pid) { return isSteward(pid); }',
    ['deeds', 'setLock', 'mold', 'moldHere', 'cutKey', 'here', 'claim', 'officeCmd',
     'evict', 'boxCmd', 'rentCmd', 'bedCmd'].map(function (n) { return 'function ' + n + '() { return true; }'; }).join('\n')
  ];
  NAMES.forEach(function (n) { body.push(lifted[n]); });
  body.push('return { boards: boards, funds: function () { return funds; }, notices: function () { return notices; }, ' +
            'command: command, boardPanel: boardPanel, boardsView: boardsView, ' +
            'deposit: deposit, withdraw: withdraw, mayWithdraw: mayWithdraw, ' +
            'heldOn: heldOn, haulTenth: haulTenth, haulTick: haulTick, saleCuts: saleCuts, inCompany: inCompany };');
  const make = new Function('reg', 'mp', 'plog', 'loadPart', 'PASSAGES', 'g', 'isSteward', 'say', 'notify', body.join('\n'));
  const api = make(reg, w.mp, function () { },
                   function (key, fallback) {
                     return Object.prototype.hasOwnProperty.call(reg, key)
                       ? JSON.parse(JSON.stringify(reg[key])) : fallback;
                   },
                   PASSAGES, ctx, function (pid) { return (opts.stewards || []).indexOf(pid) !== -1; },
                   ctx.say, ctx.notify);
  ctx.__thornswoodProperty = { saleCuts: api.saleCuts, inCompany: api.inCompany };
  api.ctx = ctx;
  api.told = {};
  api.say = function (p, line) {
    const parts = line.trim().split(/\s+/);
    const said = [];
    const to = function (pid, m) {
      (api.told[pid] = api.told[pid] || []).push(m);
      EVERY_LINE.push(m);
      if (pid === p.pid) { said.push(m); }
    };
    const answered = api.command(parts[0].toLowerCase(), parts, p.actor, p.pid, to);
    return answered ? said.join('\n') : null;
  };
  /* /yes or /no through the chat block's real branch, as handle() hands it on. */
  api.answer = function (p, text) {
    ctx.said.length = 0;
    const parts = text.trim().split(/\s+/);
    const out = [];
    new Function('globalThis', 'actorId', 'profileId', 'parts', 'word', 'toProfile', 'say', 'notify',
                 'journalCommand', YES_BRANCH)(
      ctx, p.actor, p.pid, parts, parts[0],
      function (pid, m) { out.push({ pid: pid, text: m }); },
      function (to, m) { ctx.said.push({ id: to, text: m, how: 'chat' }); }, function () { }, function () { });
    return { mine: out.map(function (x) { return x.text; }).join('\n'),
             heard: ctx.said.map(function (x) { return x.id + ': ' + x.text; }).join('\n') };
  };
  api.heard = function (p) {
    return ctx.said.filter(function (x) { return x.id === p.actor; }).map(function (x) { return x.text; }).join('\n');
  };
  return api;
}

/* Every line a person was told, through the board or the trade. */
const EVERY_LINE = [];

/* What J's Boards tab shows somebody once they pick a town there (#1627). */
function onJ(s, p, hold) {
  const said = s.say(p, '/board ' + hold);
  const v = s.boardsView(p.pid);
  v.said = said;
  return v;
}

const ALICE = { actor: 0xff000101, pid: 101, name: 'Alice', gold: 200 };
const BOB = { actor: 0xff000102, pid: 102, name: 'Bob', gold: 10 };
const CYRUS = { actor: 0xff000104, pid: 104, name: 'Cyrus', gold: 50 };
const STEW = { actor: 0xff000110, pid: 110, name: 'Steward', gold: 0 };
const CRATE = 'a crate of iron ingots';

function total(w, s, who) {
  let n = 0;
  who.forEach(function (p) { if (w.people[p.actor]) { n += w.gold(p); } });
  const f = s.funds();
  for (const k in f) { n += Number(f[k]) || 0; }
  return n;
}

// -------------------------------------------------------- the ledger goes down
attempt('withdraw', function () {
  const w = world();
  const reg = {};
  const s = boot(reg, w);
  yes('L1 deposit puts coin on, and withdraw takes it off and saves',
      s.deposit('whiterun', 100, 'test') === true && s.withdraw('whiterun', 30, 'test') === true &&
      s.funds().whiterun === 70 && reg.funds.whiterun === 70);
  yes('L2 the ledger cannot go below nothing', s.withdraw('whiterun', 71, 'x') === false && s.funds().whiterun === 70);
  yes('L3 withdraw refuses nothing, less than nothing, part of a coin, and words',
      s.withdraw('whiterun', 0, 'x') === false && s.withdraw('whiterun', -5, 'x') === false &&
      s.withdraw('whiterun', 2.5, 'x') === false && s.withdraw('whiterun', 'ten', 'x') === false &&
      s.funds().whiterun === 70);
  yes('L4 withdraw refuses a hold that is not one of the ten', s.withdraw('skyrim', 5, 'x') === false &&
      s.withdraw('__proto__', 5, 'x') === false && s.withdraw('', 5, 'x') === false);

  // An open letter's 15 and an open haul's pay are held on the ledger.
  s.notices().whiterun = [
    { by: 1, name: 'A', text: 'x', job: true, letter: true, to: 'L', pay: 15, taken: 0 },
    { by: 1, name: 'A', text: 'y', job: true, haul: true, dest: 'riften', pay: 40, taken: 0 },
    { by: 1, name: 'A', text: 'z', job: true, letter: true, to: 'M', pay: 0, taken: 0, down: 5 },
    { by: 1, name: 'A', text: 'w', job: true, taken: 0 }
  ];
  yes('L5 what is held is the open letter\'s 15 and the open haul\'s pay, not a delivered letter or a job holding no reward',
      s.heldOn('whiterun', null) === 55);
  yes('L6 a withdrawal that would leave less than is held is refused, and says why',
      s.withdraw('whiterun', 16, 'x') === false && s.funds().whiterun === 70 &&
      /70 gold, and 55 of it is held/.test(s.mayWithdraw('whiterun', 16, null)));
  yes('L7 one that leaves exactly what is held goes through', s.withdraw('whiterun', 15, 'x') === true &&
      s.funds().whiterun === 55);
  const haul = s.notices().whiterun[1];
  const letter = s.notices().whiterun[0];
  yes('L8 a haul\'s own pay can be released, and never more than it holds',
      s.withdraw('whiterun', 41, 'x', haul) === false && s.withdraw('whiterun', 36, 'x', haul) === true &&
      s.funds().whiterun === 19);
  yes('L9 releasing a haul never touches the letter\'s 15', s.mayWithdraw('whiterun', 5, haul) !== '' &&
      s.withdraw('whiterun', 4, 'x', haul) === true && s.funds().whiterun === 15);
  yes('L10 a letter or haul from another hold\'s board releases nothing here',
      s.withdraw('riften', 1, 'x', letter) === false);
});

// --------------------------------------------------------- a haul, start to finish
attempt('a haul, start to finish', function () {
  const w = world();
  [ALICE, BOB, CYRUS].forEach(w.add);
  const reg = {};
  let s = boot(reg, w);
  const everybody = [ALICE, BOB, CYRUS];
  const start = total(w, s, everybody);

  w.move(ALICE, TAMRIEL, [0, 0, 0]);
  let said = s.say(ALICE, '/haul 80 riften ' + CRATE);
  yes('H1 away from a board a haul is refused and nothing is taken',
      /Stand at the board of the hold you are sending from/.test(said) && w.gold(ALICE) === 200);
  w.at(ALICE, 'whiterun', s);
  said = s.say(ALICE, '/haul riften ' + CRATE);
  yes('H2 no pay is refused', /The pay is a whole number of gold/.test(said) && w.gold(ALICE) === 200);
  said = s.say(ALICE, '/haul 0 riften ' + CRATE);
  yes('H2 a pay of 0 is refused', /The pay is a whole number of gold/.test(said) && w.gold(ALICE) === 200);
  said = s.say(ALICE, '/haul 8.5 riften ' + CRATE);
  yes('H2 part of a coin is refused', /The pay is a whole number of gold/.test(said) && w.gold(ALICE) === 200);
  said = s.say(ALICE, '/haul 80 cyrodiil ' + CRATE);
  yes('H3 a destination that is not one of the ten towns is refused', /one of the ten towns/.test(said) &&
      w.gold(ALICE) === 200);
  said = s.say(ALICE, '/haul 80 whiterun ' + CRATE);
  yes('H3 a haul to the hold it is posted in is refused', /from one hold to another/.test(said) &&
      w.gold(ALICE) === 200);
  said = s.say(ALICE, '/haul 80 riften');
  yes('H4 a haul that says nothing is refused', /Say what it carries/.test(said) && w.gold(ALICE) === 200);
  w.at(BOB, 'whiterun', s);
  said = s.say(BOB, '/haul 5 riften a letter');
  yes('H5 a pack that cannot cover the fee and the pay pays nothing and posts nothing',
      /That costs 35 gold/.test(said) && w.gold(BOB) === 10 && !(s.notices().whiterun || []).length &&
      !s.funds().whiterun);

  said = s.say(ALICE, '/haul 80 riften ' + CRATE);
  yes('H6 a haul goes up for 110, the 30 fee and the 80 pay in full',
      /That cost 110 gold: 30 for the board, and the 80 pay/.test(said) && w.gold(ALICE) === 90);
  yes('H6 and both are on the posting hold\'s ledger', s.funds().whiterun === 110 && !s.funds().riften);
  const n = s.notices().whiterun[0];
  yes('H6 it is a job, a haul, with the pay and the destination', n.job === true && n.haul === true &&
      n.pay === 80 && n.dest === 'riften' && n.text === CRATE && !n.taken);
  yes('H6 the total of packs and ledgers has not moved', total(w, s, everybody) === start);
  const wall = onJ(s, CYRUS, 'whiterun');
  yes('H7 the wall shows it as a job, with the pay and the destination, on J from anywhere',
      wall.said === '' && wall.read.hold === 'whiterun' && wall.read.wall.length === 1 &&
      wall.read.wall[0].n === 1 && wall.read.wall[0].job === true && wall.read.wall[0].haul === true &&
      wall.read.wall[0].name === 'Alice' && wall.read.wall[0].text === 'haul to riften for 80 gold: ' + CRATE);
  const panel = s.boardPanel(CYRUS.actor, CYRUS.pid);
  yes('H7 and so does the panel', panel && panel.wall[0].job === true &&
      panel.wall[0].text === 'haul to riften for 80 gold: ' + CRATE);

  said = s.say(ALICE, '/take 1');
  yes('T1 the poster cannot take their own haul', /your own/.test(said));
  said = s.say(BOB, '/take 1');
  yes('T2 anybody takes it, the same as any job, and is told where and how it is paid',
      /You take the haul to riften/.test(said) && /Alice or a steward confirms it on the board/.test(said) &&
      /72 gold is yours/.test(said) &&
      /company keeps 8/.test(said) && s.notices().whiterun[0].taken === BOB.pid);
  yes('T3 one taker', /Bob has that one/.test(s.say(CYRUS, '/take 1')));
  const bobs = onJ(s, BOB, 'riften').jobs;
  yes('T4 it is in the hauler\'s Your jobs with its number, wherever they are reading',
      bobs.length === 1 && bobs[0].hold === 'whiterun' && bobs[0].n === 1 && bobs[0].haul === true &&
      bobs[0].name === 'Alice' && bobs[0].text === 'haul to riften for 80 gold: a crate of iron ingots');
  yes('T4 and on the board panel, where Hand it back is', s.boardPanel(BOB.actor, BOB.pid).jobs.length === 1);

  // Confirming.
  said = s.say(ALICE, '/haul done whiterun 1');
  yes('C1 confirming at the posting board does nothing', /confirmed at riften's board/.test(said) &&
      w.gold(BOB) === 10 && s.funds().whiterun === 110);
  w.at(ALICE, 'riften', s);
  w.at(CYRUS, 'riften', s);
  w.at(BOB, 'riften', s);
  said = s.say(CYRUS, '/haul done whiterun 1');
  yes('C2 somebody who is neither the poster nor a steward cannot confirm it',
      /Only the person who posted it, or a steward/.test(said) && w.gold(BOB) === 10);
  said = s.say(BOB, '/haul done whiterun 1');
  yes('C3 the hauler cannot confirm it', /Only the person who posted it/.test(said) && w.gold(BOB) === 10);
  said = s.say(ALICE, '/haul done whiterun');
  yes('C4 a confirm without the number is refused', /That haul is not on any board/.test(said));
  said = s.say(ALICE, '/haul done whiterun 9');
  yes('C4 and one with a number that is not on the board', /There is no number 9/.test(said));

  // A restart in the middle: the haul, its taker and its held pay are all on the register.
  s = boot(reg, w);
  yes('R1 after a restart the haul is still up, still taken, and its pay still held',
      s.notices().whiterun[0].taken === BOB.pid && s.funds().whiterun === 110 && s.heldOn('whiterun', null) === 80);

  said = s.say(ALICE, '/haul done whiterun 1');
  yes('C6 the poster confirms it at the destination: the hauler is paid 72',
      /Bob is paid 72 gold out of whiterun's ledger, and the company keeps 8/.test(said) && w.gold(BOB) === 82);
  yes('C6 and the ledger keeps 38, the 30 fee and the 8 tenth', s.funds().whiterun === 38 && reg.funds.whiterun === 38);
  yes('C6 the haul is down, paid, and nothing is held for it any more',
      !!s.notices().whiterun[0].down && s.notices().whiterun[0].pay === 0 && s.notices().whiterun[0].paid === 72 &&
      s.notices().whiterun[0].kept === 8 && s.heldOn('whiterun', null) === 0);
  yes('C6 the hauler is told', (s.told[BOB.pid] || []).some(function (m) { return /72 gold is in your pack/.test(m); }));
  yes('C6 the total of packs and ledgers has not moved: the pay was moved, not made', total(w, s, everybody) === start);
  said = s.say(ALICE, '/haul done whiterun 1');
  yes('C7 it is paid once', /already paid or taken down/.test(said) && w.gold(BOB) === 82 && s.funds().whiterun === 38);
  yes('C8 the wall no longer shows it', onJ(s, CYRUS, 'whiterun').read.wall.length === 0);
});

// ------------------------------------------- somebody paid who is away
attempt('somebody away', function () {
  const w = world();
  const P = { actor: 0xff000401, pid: 401, name: 'Poster', gold: 300 };
  const H = { actor: 0xff000402, pid: 402, name: 'Hauler', gold: 0 };
  const O = { actor: 0xff000403, pid: 403, name: 'Other', gold: 0 };
  [P, H, O].forEach(w.add);
  const reg = {};
  let s = boot(reg, w);
  const everybody = [P, H, O];
  const start = total(w, s, everybody);
  [P, H, O].forEach(function (p) { w.at(p, 'markarth', s); });
  s.say(P, '/haul 50 dawnstar silver');
  s.say(H, '/take 1');
  w.at(P, 'dawnstar', s);
  w.leave(H);
  let said = s.say(P, '/haul done markarth 1');
  yes('A1 a hauler away when it is confirmed: it comes down, the company keeps its 5, and the 45 is held for them',
      /Hauler is away, so the 45 gold is held on markarth's ledger for them until they are next in the world, and the company keeps 5/.test(said) &&
      !!s.notices().markarth[0].down && s.funds().markarth === 80 && s.heldOn('markarth', null) === 45 && w.gold(H) === 0);
  yes('A1 it cannot be confirmed twice', /already paid or taken down/.test(s.say(P, '/haul done markarth 1')) &&
      s.funds().markarth === 80);
  yes('A2 what is held for the hauler cannot be spent', s.withdraw('markarth', 36, 'x') === false &&
      s.funds().markarth === 80);
  s = boot(reg, w);
  yes('A3 after a restart it is still held for them', s.heldOn('markarth', null) === 45 && s.funds().markarth === 80 &&
      s.notices().markarth[0].owed === 45 && s.notices().markarth[0].owedTo === H.pid);
  s.haulTick();
  yes('A4 while they are away nothing is handed over', w.gold(H) === 0 && s.funds().markarth === 80);
  w.come(H);
  s.haulTick();
  yes('A5 they come into the world: the 45 is in their pack, off the ledger, and they are told the company kept 5',
      w.gold(H) === 45 && s.funds().markarth === 35 && s.heldOn('markarth', null) === 0 &&
      /While you were away, your haul to dawnstar was confirmed. 45 gold is in your pack. The company kept 5/.test(s.heard(H)));
  s.haulTick();
  yes('A5 once', w.gold(H) === 45 && s.funds().markarth === 35);
  yes('A6 the ledger keeps the 30 fee and the 5 tenth, and the coin only moved',
      s.funds().markarth === 35 && total(w, s, everybody) === start);

  w.at(P, 'markarth', s);
  w.at(H, 'markarth', s);
  s.say(P, '/haul 20 riften wine');
  s.say(H, '/take 2');
  w.leave(P);
  said = s.say(H, '/dropjob 2');
  yes('A7 a hauler drops a haul with the poster away: it comes down, and the 20 is held for the poster',
      /It comes down, and the 20 gold pay goes back to Poster when they are next in the world/.test(said) &&
      !!s.notices().markarth[1].down && s.heldOn('markarth', null) === 20 && s.funds().markarth === 85);
  w.come(P);
  s.haulTick();
  yes('A8 the poster comes back and has the pay, and the fee stays',
      s.funds().markarth === 65 && s.heldOn('markarth', null) === 0 &&
      /While you were away, your haul to riften came down. The 20 gold pay is back in your pack. The fee stays with markarth/.test(s.heard(P)) &&
      total(w, s, everybody) === start);

  // A ledger short of what it holds, as if somebody had spent it: the owed gold waits, and nothing is made.
  s.say(P, '/haul 40 riften wine');
  s.say(O, '/take 3');
  w.leave(P);
  s.say(O, '/dropjob 3');
  reg.funds.markarth = 10;
  s = boot(reg, w);
  w.come(P);
  const had = w.gold(P);
  s.haulTick();
  yes('A9 a ledger that cannot pay what it owes pays nothing, and the gold stays owed',
      w.gold(P) === had && s.funds().markarth === 10 && s.notices().markarth[2].owed === 40);
});

// ------------------------------------------------- the tenth, by the page's table
attempt('the tenth', function () {
  const table = [[9, 0, 9], [10, 1, 9], [25, 2, 23], [80, 8, 72], [100, 10, 90]];
  const s0 = boot({}, world());
  yes('K1 the page\'s table: 9 keeps 0, 10 keeps 1, 25 keeps 2, 80 keeps 8, 100 keeps 10',
      table.every(function (r) { return s0.haulTenth(r[0]) === r[1]; }));
  table.forEach(function (r) {
    const w = world();
    const P = { actor: 0xff000201, pid: 201, name: 'Poster', gold: 500 };
    const H = { actor: 0xff000202, pid: 202, name: 'Hauler', gold: 0 };
    w.add(P); w.add(H);
    const s = boot({}, w);
    w.at(P, 'solitude', s);
    w.at(H, 'solitude', s);
    s.say(P, '/haul ' + r[0] + ' morthal goods');
    s.say(H, '/take 1');
    w.at(P, 'morthal', s);
    const said = s.say(P, '/haul done solitude 1');
    yes('K2 a pay of ' + r[0] + ': the hauler receives ' + r[2] + ' and the ledger keeps the 30 fee and ' + r[1],
        w.gold(H) === r[2] && s.funds().solitude === 30 + r[1] &&
        (r[1] ? /company keeps/.test(said) : /Under 10 gold, the company keeps nothing/.test(said)));
  });
});

// ----------------------------------------- an ordinary job is not a haul
attempt('an ordinary job', function () {
  const w = world();
  [ALICE, BOB].forEach(w.add);
  const s = boot({}, w, { stewards: [ALICE.pid] });
  w.at(ALICE, 'whiterun', s);
  w.at(BOB, 'whiterun', s);
  s.say(ALICE, '/job 20 Carry my crate :: To Riften, by the gate.');
  s.say(BOB, '/take 1');
  w.at(ALICE, 'riften', s);
  const said = s.say(ALICE, '/haul done whiterun 1');
  yes('J1 /haul done on an ordinary job is refused, and the taker is paid nothing by it',
      /That is not a haul/.test(said) && w.gold(BOB) === 10 && s.funds().whiterun === 50);
  yes('J2 and the job is still up and still theirs', !s.notices().whiterun[0].down &&
      s.notices().whiterun[0].taken === BOB.pid);
});

// ----------------------------------------------- taking a haul down
attempt('taking a haul down', function () {
  const w = world();
  [ALICE, BOB, CYRUS, STEW].forEach(w.add);
  const reg = {};
  const s = boot(reg, w, { stewards: [STEW.pid] });
  const everybody = [ALICE, BOB, CYRUS, STEW];
  const start = total(w, s, everybody);
  [ALICE, BOB, CYRUS, STEW].forEach(function (p) { w.at(p, 'whiterun', s); });

  s.say(ALICE, '/haul 50 riften salt');
  yes('U0 posted for 80', w.gold(ALICE) === 120 && s.funds().whiterun === 80);
  let said = s.say(CYRUS, '/unpin 1');
  yes('U1 somebody else cannot take it down', /not yours/.test(said) && s.funds().whiterun === 80);
  said = s.say(ALICE, '/unpin 1');
  yes('U2 the poster takes it down before anybody has taken it: the pay comes back, the fee stays',
      /The 50 gold pay comes back to you. The fee stays with whiterun/.test(said) && w.gold(ALICE) === 170 &&
      s.funds().whiterun === 30 && !!s.notices().whiterun[0].down);
  yes('U2 and nothing is held for it', s.heldOn('whiterun', null) === 0 && total(w, s, everybody) === start);

  s.say(ALICE, '/haul 50 riften salt');
  s.say(BOB, '/take 2');
  said = s.say(ALICE, '/unpin 2');
  yes('U3 once taken, the poster cannot take it down', /Bob has taken that job/.test(said) &&
      w.gold(ALICE) === 90 && s.funds().whiterun === 110);
  said = s.say(CYRUS, '/dropjob 2');
  yes('U4 nobody but the hauler hands it back', /not one of yours/.test(said) && s.notices().whiterun[1].taken === BOB.pid);
  said = s.say(BOB, '/dropjob 2');
  yes('U4 the hauler hands it back: the haul comes down, the pay goes back to the poster, the fee stays',
      /You hand the haul to riften back. It comes down, and the 50 gold pay goes back to Alice. The fee stays with whiterun/.test(said) &&
      !!s.notices().whiterun[1].down && w.gold(ALICE) === 140 && s.funds().whiterun === 60 && w.gold(BOB) === 10);
  yes('U4 the poster is told, nothing is held for it, and the coin only moved',
      (s.told[ALICE.pid] || []).some(function (m) { return /Bob handed your haul to riften back. The 50 gold pay is back in your pack/.test(m); }) &&
      s.heldOn('whiterun', null) === 0 && total(w, s, everybody) === start);
  yes('U5 it is off the hauler\'s list and nobody can take it now',
      onJ(s, BOB, 'whiterun').jobs.length === 0 && /has been taken down/.test(s.say(CYRUS, '/take 2')));
  yes('U5 and a second drop or a confirm pays nothing more',
      /not one of yours/.test(s.say(BOB, '/dropjob 2')) && w.gold(ALICE) === 140 && s.funds().whiterun === 60);

  s.say(ALICE, '/haul 40 markarth ore');
  s.say(BOB, '/take 3');
  w.leave(ALICE);
  said = s.say(STEW, '/unpin 3');
  yes('U6 a steward cancels a taken haul at the posting board with the poster away: it comes down, ' +
      'and the pay is held for them',
      /goes back to them when they are next in the world. The fee stays with whiterun/.test(said) &&
      !!s.notices().whiterun[2].down && s.funds().whiterun === 130 && w.gold(ALICE) === 70 &&
      s.heldOn('whiterun', null) === 40);
  yes('U6 the hauler is told', (s.told[BOB.pid] || []).some(function (m) { return /taken down by a steward/.test(m); }));
  yes('U6 what is held for the poster cannot be spent', s.withdraw('whiterun', 91, 'x') === false &&
      s.funds().whiterun === 130);
  s.haulTick();
  yes('U7 while the poster is away nothing is handed over', w.gold(ALICE) === 70 && s.funds().whiterun === 130);
  w.come(ALICE);
  s.haulTick();
  yes('U7 the poster comes back into the world: the pay is in their pack and off the ledger, the fee stays',
      w.gold(ALICE) === 110 && s.funds().whiterun === 90 && s.heldOn('whiterun', null) === 0 &&
      /While you were away, your haul to markarth came down. The 40 gold pay is back in your pack/.test(s.heard(ALICE)));
  s.haulTick();
  yes('U7 and it is handed over once', w.gold(ALICE) === 110 && s.funds().whiterun === 90);
  yes('U8 the company kept nothing on any of them, and the coin only moved',
      s.funds().whiterun === 90 && total(w, s, everybody) === start);
  yes('U9 a steward is not a steward of a plain notice', /not yours/.test((function () {
    s.say(ALICE, '/notice hello :: hello'); return s.say(STEW, '/unpin 4');
  })()));
  s.say(ALICE, '/haul 30 riften wool');
  s.say(BOB, '/take 5');
  w.at(STEW, 'riften', s);
  w.at(BOB, 'riften', s);
  w.leave(ALICE);
  said = s.say(STEW, '/haul done whiterun 5');
  yes('U10 a steward confirms a haul at the destination with the poster away, and the poster is told',
      /Bob is paid 27/.test(said) && w.gold(BOB) === 37 &&
      (s.told[ALICE.pid] || []).some(function (m) { return /confirmed by a steward/.test(m); }));
  w.come(ALICE);
  w.people[ALICE.actor].pack.push({ baseId: GOLD, count: 100 });
  s.say(ALICE, '/haul 30 riften wool');
  w.at(STEW, 'whiterun', s);
  s.say(STEW, '/take 6');
  w.at(STEW, 'riften', s);
  said = s.say(STEW, '/haul done whiterun 6');
  yes('U11 a steward who hauled it does not confirm their own haul', /does not confirm their own/.test(said) &&
      w.gold(STEW) === 0 && s.notices().whiterun[5].taken === STEW.pid && !s.notices().whiterun[5].down);
});

// ------------------------------------------- held pay is never spent
attempt('held pay', function () {
  const w = world();
  const LYDIA = { actor: 0xff000103, pid: 103, name: 'Lydia', gold: 0 };
  [ALICE, BOB, LYDIA].forEach(w.add);
  const reg = {};
  let s = boot(reg, w);
  [ALICE, BOB, LYDIA].forEach(function (p) { w.at(p, 'whiterun', s); });
  s.say(ALICE, '/letter Lydia Meet me at dusk.');
  s.say(ALICE, '/haul 80 riften iron');
  s.say(BOB, '/take 2');
  yes('P1 a letter and a haul hold 95 on a ledger of 145', s.funds().whiterun === 145 && s.heldOn('whiterun', null) === 95);
  // A ledger that is short of what it holds, as if somebody had spent it.
  reg.funds.whiterun = 80;
  s = boot(reg, w);
  w.at(ALICE, 'riften', s);
  w.at(BOB, 'riften', s);
  const said = s.say(ALICE, '/haul done whiterun 2');
  yes('P2 a haul is not paid out of a letter\'s held 15: on a short ledger it is refused and nothing moves',
      /That did not work/.test(said) && /held for letters, hauls and jobs/.test(said) && w.gold(BOB) === 10 &&
      s.funds().whiterun === 80 && !s.notices().whiterun[1].down);
  w.at(BOB, 'whiterun', s);
  s.say(BOB, '/take 1');
  w.move(LYDIA, w.people[BOB.actor].cell, w.people[BOB.actor].pos);
  const delivered = s.say(BOB, '/deliver Lydia');
  yes('P3 and the letter is still delivered and its 15 paid', /15 gold is yours/.test(delivered) &&
      w.gold(BOB) === 25 && s.funds().whiterun === 65);
});

// ------------------------------------------------- the haul's two buttons
attempt('the board panel', function () {
  const w = world();
  const P = { actor: 0xff000501, pid: 501, name: 'Poster', gold: 300 };
  const H = { actor: 0xff000502, pid: 502, name: 'Hauler', gold: 0 };
  const X = { actor: 0xff000503, pid: 503, name: 'Stranger', gold: 0 };
  const ST = { actor: 0xff000504, pid: 504, name: 'Steward', gold: 0 };
  [P, H, X, ST].forEach(w.add);
  const s = boot({}, w, { stewards: [ST.pid] });
  [P, H, X, ST].forEach(function (p) { w.at(p, 'falkreath', s); });
  let panel = s.boardPanel(P.actor, P.pid);
  const towns = (panel && panel.dests || []).map(function (d) { return d.hold; });
  yes('B1 Send a haul offers every other town with a board, and not this one',
      towns.length === 9 && towns.indexOf('falkreath') === -1 && towns.indexOf('ravenrock') !== -1 &&
      panel.dests.every(function (d) { return !!d.where; }));
  s.say(P, '/haul 60 windhelm furs');
  panel = s.boardPanel(X.actor, X.pid);
  yes('B2 the wall marks it as a haul, with the pay and the town', panel.wall[0].haul === true &&
      panel.wall[0].job === true && panel.wall[0].text === 'haul to windhelm for 60 gold: furs');
  yes('B3 a steward is told they are one, so the panel offers them Take down on a haul',
      s.boardPanel(ST.actor, ST.pid).steward === true && panel.steward === false);
  s.say(H, '/take 1');
  [P, H, X, ST].forEach(function (p) { w.at(p, 'windhelm', s); });
  const mine = s.boardPanel(P.actor, P.pid).arrivals;
  yes('B4 at the town it went to, the poster sees it under Hauls that came here, with the split',
      mine.length === 1 && mine[0].from === 'falkreath' && mine[0].n === 1 && mine[0].hauler === 'Hauler' &&
      mine[0].pay === 60 && mine[0].kept === 6 && mine[0].text === 'furs' && !!mine[0].where);
  yes('B5 so does a steward, and nobody else, and not the hauler',
      s.boardPanel(ST.actor, ST.pid).arrivals.length === 1 && s.boardPanel(X.actor, X.pid).arrivals.length === 0 &&
      s.boardPanel(H.actor, H.pid).arrivals.length === 0);
  w.at(P, 'riften', s);
  yes('B6 not at another town\'s board', s.boardPanel(P.actor, P.pid).arrivals.length === 0);
  w.at(P, 'windhelm', s);
  const said = s.say(P, '/haul done ' + mine[0].from + ' ' + mine[0].n);
  yes('B7 the line Confirm sends pays the hauler, and it is gone from the list',
      /Hauler is paid 54/.test(said) && w.gold(H) === 54 && s.boardPanel(P.actor, P.pid).arrivals.length === 0);

  const page = read('game/ui/thornswood-board.js');
  yes('B8 the panel sends the haul and the confirm, and draws both lists',
      page.indexOf("net('/haul ' + pay + ' ' + dest + ' ' + what)") !== -1 &&
      page.indexOf("net('/haul done ' + from + ' ' + n)") !== -1 &&
      /b\.dests/.test(page) && /b\.arrivals/.test(page) && /Send a haul/.test(page) && /Confirm/.test(page) &&
      /row\.haul && b\.steward/.test(page));
});

// ------------------------------------------------- a sale out of Skyrim
attempt('a company sale', function () {
  const w = world();
  const WORKER = { actor: 0xff000301, pid: 301, name: 'Worker', gold: 300 };
  const SELLER = { actor: 0xff000302, pid: 302, name: 'Seller', gold: 0,
                   items: [{ baseId: SWORD, count: 1 }, { baseId: PELT, count: 3 }] };
  const OTHER = { actor: 0xff000303, pid: 303, name: 'Other', gold: 500, items: [{ baseId: PELT, count: 1 }] };
  const ADMIN = { actor: 0xff000304, pid: 304, name: 'Admin', gold: 50 };
  const MATE = { actor: 0xff000305, pid: 305, name: 'Mate', gold: 40 };
  [WORKER, SELLER, OTHER, ADMIN, MATE].forEach(w.add);
  const s = boot({}, w, { company: [WORKER.pid, MATE.pid], admin: [ADMIN.pid] });
  const tr = s.ctx.__thornswoodTrade;
  const everybody = [WORKER, SELLER, OTHER, ADMIN, MATE];
  const before = total(w, s, everybody);
  function view(p) { const t = tr.tradeOf(p.actor); return t ? tr.view(t, p.actor) : null; }
  function agree(a, b) { const one = tr.confirm(a.actor); const two = tr.confirm(b.actor); EVERY_LINE.push(one, two); return one + two; }
  function heard(p) { return s.heard(p); }

  yes('S1 somebody the company has not taken on is not offered Buy for the company, and cannot press it',
      tr.begin(OTHER.actor, SELLER.actor) === '' && view(OTHER).canBuy === false &&
      /Only somebody the Free Skyrim Trading Company has taken on/.test(tr.sale(OTHER.actor)) &&
      !tr.tradeOf(OTHER.actor).sale);
  tr.cancel(OTHER.actor);

  yes('S2 a worker opens an ordinary trade and is offered Buy for the company; the seller is not',
      tr.begin(WORKER.actor, SELLER.actor) === '' && view(WORKER).canBuy === true && view(SELLER).canBuy === false &&
      view(WORKER).sale === null);
  tr.add(SELLER.actor, 'Iron Sword', 1);
  tr.gold(WORKER.actor, 120);
  tr.confirm(SELLER.actor);
  yes('S3 pressing it makes it a sale and takes both agreements back',
      tr.sale(WORKER.actor) === '' && tr.tradeOf(WORKER.actor).sale === WORKER.actor &&
      view(SELLER).iAgreed === false && view(WORKER).iAgreed === false);
  const sv = view(SELLER).sale;
  yes('S4 both see the split of the price the worker put up, before anybody agrees',
      sv && sv.mine === false && sv.worker === 'Worker' && sv.price === 120 && sv.cut === 12 && sv.gone === 12 &&
      sv.seller === 96 && view(WORKER).sale.mine === true);
  yes('S4 and the seller is told what it means', /buying for the Free Skyrim Trading Company/.test(heard(SELLER)) &&
      /leaves Skyrim and does not come back/.test(heard(SELLER)));
  yes('S5 nothing has moved yet', w.gold(WORKER) === 300 && w.gold(SELLER) === 0 && w.count(SELLER, SWORD) === 1);
  agree(WORKER, SELLER);
  yes('S6 both agree: 96 to the seller, the worker pays 108, and 12 leaves the world',
      w.gold(SELLER) === 96 && w.gold(WORKER) === 192 && total(w, s, everybody) === before - 12);
  yes('S6 the sword has left the world: it is in nobody\'s pack',
      everybody.every(function (p) { return w.count(p, SWORD) === 0; }));
  yes('S6 both are told, and the trade is over',
      /Iron Sword left Skyrim. You receive 96: 12 went to Worker for handling it, and 12 left the world/.test(heard(SELLER)) &&
      /It cost you 108/.test(heard(WORKER)) && !tr.tradeOf(WORKER.actor) && !tr.tradeOf(SELLER.actor));
  yes('S6 no ledger moved', JSON.stringify(s.funds()) === '{}');

  const mid = total(w, s, everybody);
  tr.begin(WORKER.actor, SELLER.actor);
  tr.sale(WORKER.actor);
  tr.add(SELLER.actor, 'Bear Pelt', 1);
  tr.gold(WORKER.actor, 9);
  agree(WORKER, SELLER);
  yes('S7 under 10 gold the seller receives the whole price and nothing is destroyed',
      w.gold(SELLER) === 105 && w.gold(WORKER) === 183 && total(w, s, everybody) === mid &&
      /Under 10 gold nothing is cut, and you receive the whole 9/.test(heard(SELLER)));
  yes('S7 and the pelt leaves the world', w.count(SELLER, PELT) === 2 && w.count(WORKER, PELT) === 0);
  tr.begin(WORKER.actor, SELLER.actor);
  tr.sale(WORKER.actor);
  tr.add(SELLER.actor, 'Bear Pelt', 1);
  tr.gold(WORKER.actor, 10);
  agree(WORKER, SELLER);
  yes('S8 at 10 gold: 1 to the worker, 1 destroyed, 8 to the seller',
      w.gold(SELLER) === 113 && w.gold(WORKER) === 174 && total(w, s, everybody) === mid - 1 && w.count(SELLER, PELT) === 1);
  yes('S9 the cuts by the page: 10% and 10% rounded down, nothing under 10',
      JSON.stringify(s.saleCuts(125)) === JSON.stringify({ price: 125, worker: 12, gone: 12, seller: 101 }) &&
      JSON.stringify(s.saleCuts(9)) === JSON.stringify({ price: 9, worker: 0, gone: 0, seller: 9 }));

  // The refusals, each checked when both have agreed, and each moves nothing.
  const still = total(w, s, everybody);
  function nothingMoved() {
    return w.gold(SELLER) === 113 && w.gold(WORKER) === 174 && w.count(SELLER, PELT) === 1 &&
           total(w, s, everybody) === still;
  }
  tr.begin(WORKER.actor, SELLER.actor);
  tr.sale(WORKER.actor);
  tr.gold(WORKER.actor, 50);
  let said = agree(WORKER, SELLER);
  yes('S10 nothing put up to sell is refused', /Seller has put up nothing to sell/.test(said) && nothingMoved() &&
      !!tr.tradeOf(WORKER.actor) && view(WORKER).iAgreed === false);
  tr.add(SELLER.actor, 'Bear Pelt', 1);
  tr.gold(WORKER.actor, 0);
  said = agree(WORKER, SELLER);
  yes('S11 no price is refused: the price is what the two agree, and the thing has none of its own',
      /Worker has put up no gold for it/.test(said) && nothingMoved());
  tr.gold(WORKER.actor, 50);
  tr.gold(SELLER.actor, 5);
  said = agree(WORKER, SELLER);
  yes('S12 the seller putting up gold is refused: only the company pays',
      /Only the company pays in a sale/.test(said) && nothingMoved());
  tr.gold(SELLER.actor, 0);
  w.people[WORKER.actor].pack.push({ baseId: PELT, count: 1 });
  tr.add(WORKER.actor, 'Bear Pelt', 1);
  said = agree(WORKER, SELLER);
  yes('S13 the worker putting up things is refused: the company pays in gold',
      /The company pays in gold/.test(said) && w.count(WORKER, PELT) === 1 && w.count(SELLER, PELT) === 1);
  tr.remove(WORKER.actor, 'Bear Pelt');
  w.people[WORKER.actor].pack = w.people[WORKER.actor].pack.filter(function (e) { return e.baseId !== PELT; });
  w.people[SELLER.actor].pack = w.people[SELLER.actor].pack.filter(function (e) { return e.baseId !== PELT; });
  said = agree(WORKER, SELLER);
  yes('S14 a pelt dropped after it was put up: nothing changes hands and the worker keeps the gold',
      /does not have the Bear Pelt any more/.test(said) && w.gold(WORKER) === 174 && w.gold(SELLER) === 113);
  w.people[SELLER.actor].pack.push({ baseId: PELT, count: 1 });
  s.ctx.__thornswoodIsCompany = function () { return false; };
  said = agree(WORKER, SELLER);
  yes('S15 a worker the company no longer has cannot finish one', /Worker cannot buy for the company now/.test(said) &&
      nothingMoved());
  s.ctx.__thornswoodIsCompany = function (pid) { return pid === WORKER.pid || pid === MATE.pid; };
  yes('S16 pressing it again makes it an ordinary trade, and the pelt crosses instead of leaving',
      tr.sale(WORKER.actor) === '' && !tr.tradeOf(WORKER.actor).sale && view(SELLER).sale === null &&
      agree(WORKER, SELLER) === '' && w.count(WORKER, PELT) === 1 && w.gold(SELLER) === 163 &&
      total(w, s, everybody) === still);

  tr.begin(WORKER.actor, MATE.actor);
  tr.sale(WORKER.actor);
  yes('S17 two workers: only one buys, and the other is not offered it',
      view(MATE).canBuy === false && /Worker is already buying for the company/.test(tr.sale(MATE.actor)));
  tr.cancel(WORKER.actor);

  tr.begin(ADMIN.actor, OTHER.actor);
  tr.sale(ADMIN.actor);
  tr.add(OTHER.actor, 'Bear Pelt', 1);
  tr.gold(ADMIN.actor, 20);
  agree(ADMIN, OTHER);
  yes('S18 an admin can handle one, to test the chain, the same as a Jarl',
      w.count(OTHER, PELT) === 0 && w.gold(ADMIN) === 32 && w.gold(OTHER) === 516);

  const trade = read('game/ui/thornswood-trade.js');
  yes('S19 the trade panel has the button for a worker, sends the line, and shows the split to both',
      trade.indexOf("net('/trade sale')") !== -1 && /data\.canBuy/.test(trade) && /Buy for the company/.test(trade) &&
      /saleLine\(data\.sale\)/.test(trade) && /leaves the world/.test(trade));
  const branch = slice(gm, "      if (word === '/trade') {", "      if (!found.actorId) { toProfile(profileId, found.why); return true; }");
  yes('S20 the chat block hands the panel\'s line to the trade block',
      !!branch && /verb === 'sale'\) \{ out = tr2\.sale\(actorId\); \}/.test(branch) && /verb === 'pack' \|\| verb === 'sale'/.test(branch));
  ctxSaid(s.ctx);
});

function ctxSaid(ctx) { ctx.said.forEach(function (x) { EVERY_LINE.push(x.text); }); }

// --------------------------------------------------------------- the wiring
attempt('the wiring', function () {
  function arrayOf(name) {
    const m = new RegExp('^const ' + name + ' = (\\[[\\s\\S]*?\\]);$', 'm').exec(gm);
    if (!m) { return null; }
    try { return new Function('return ' + m[1])(); } catch (e) { return null; }
  }
  const WORDS = arrayOf('WORDS');
  const PLAYER_WORDS = arrayOf('PLAYER_WORDS');
  yes('W1 /haul is a word the server answers for the board panel, and nobody is told of it; /company is gone',
      !!WORDS && WORDS.indexOf('/haul') !== -1 && WORDS.indexOf('/company') === -1 &&
      !!PLAYER_WORDS && PLAYER_WORDS.indexOf('/haul') === -1 && PLAYER_WORDS.indexOf('/company') === -1);
  yes('W2 the character block hands /haul to the property block', /word === '\/haul' \|\|/.test(gm) &&
      !/word === '\/company'/.test(gm));
  yes('W3 the property block answers /haul', /if \(word === '\/haul'\) \{ return haulCmd\(/.test(prop));
  yes('W4 the property block hands out withdraw, the cuts and who is in the company',
      /withdraw: withdraw, mayWithdraw: mayWithdraw/.test(prop) && /saleCuts: saleCuts, inCompany: inCompany/.test(prop) &&
      !/acceptSale/.test(gm));
  yes('W5 nobody was told to type /haul, /company or /trade sale, nor a board word (#1627)',
      EVERY_LINE.length > 50 && EVERY_LINE.every(function (m) {
        return !/\/haul|\/company|\/trade sale|\/board|\/jobs?\b|\/take|\/unpin|\/dropjob|\/notice/.test(String(m));
      }));

  const door = slice(gm, '// ==== thornswood door ====', '// ==== end thornswood door ====');
  yes('W6 the door reads companyProfiles and answers __thornswoodIsCompany only for a proved profile',
      !!door && /doc\.companyProfiles/.test(door) && /companyIds: companyIds/.test(door) &&
      /__thornswoodIsCompany = function \(profileId\) \{\s*var l = load\(\);\s*return passProved\(profileId\) && !!\(l && l\.companyIds/.test(door));
  yes('W7 and writes it into allowed.json, kept for a profile Discord could not answer for',
      /companyProfiles: Array\.isArray\(doc\.companyProfiles\) \? doc\.companyProfiles : \[\],/.test(door) &&
      /companyProfiles: merged\(doc\.companyProfiles, had\.companyProfiles\),/.test(door) &&
      /doc\.companyProfiles = kept\.companyProfiles;/.test(door));

  const site = siteFiles.source();
  const def = /cfg\.access\.company = \['([^']+)'\];/.exec(site);
  yes('W8 the site gives the role a default name, reads it, and sends companyProfiles to the door',
      !!def && /out\.company = has\(cfg\.access\.company\);/.test(site) &&
      /out\.companyProfiles\.push\(n\)/.test(site) && /'devRoleProfiles', 'companyProfiles'\]/.test(site));
  const bot = read('bot/bot.py');
  yes('W9 applying for the company is the Faction Leader ticket, not a Trading Company form',
      /\('faction',\s+'Apply: Faction Leader'/.test(bot) && /'faction': \[/.test(bot) &&
      !/\('company',\s+'Apply: Trading Company'/.test(bot) &&
      !/'company':\s+'Trading Company'/.test(bot) && !/'company': \[/.test(bot) &&
      bot.indexOf('No GM or staff member (Loremaster, Discord Moderator, or any other staff role) may hold an in-game RP role with faction leadership, such as a Jarl or a faction lead.') !== -1);
  const build = read('bot/Build-Discord.py');
  // Since #3317 the role is the company's member role, the faction's own
  // name in bot/factions.json, which Build-Discord.py makes for every faction.
  const factions = JSON.parse(read('bot/factions.json'));
  yes('W10 and Build-Discord.py makes that role, so there is one to give',
      !!def && factions.indexOf(def[1]) !== -1 &&
      /FACTION_MEMBERS = tuple\(FACTION_SHORT\.get\(f, f\) for f in FACTIONS\)/.test(build) &&
      /for _name in FACTION_MEMBERS:\n    ROLES\.append\(\(_name, /.test(build) &&
      !/'Free Skyrim Trading Company':/.test(build.slice(build.indexOf('FACTION_SHORT = {'), build.indexOf('FACTION_SHORT = {') + 200)));
  const party = read('game/ui/thornswood-party.js');
  yes('W11 there is no sale on the request prompt and no sale in /yes: the sale is the trade panel',
      party.indexOf("'sale'") === -1 && !/o\.kind === 'sale'/.test(YES_BRANCH));
});

// ------------------------------------------------------------------ the page
attempt('the pages', function () {
  const page = read('docs/systems/trading-company.md');
  const where = page.slice(page.indexOf('## Where this is'));
  yes('D1 the trading company page no longer says the company is not built, and names the buttons, not a command',
      !/^Not built\./m.test(where) && /Send a haul/.test(page) && /Buy for the company/.test(page) &&
      !/`\/haul|`\/company/.test(page));
  const property = read('docs/systems/property.md');
  yes('D2 the property page no longer says the payout is not built',
      property.indexOf('The company payout that\nwithdraws from the ledger is not built') === -1);
});

done();
