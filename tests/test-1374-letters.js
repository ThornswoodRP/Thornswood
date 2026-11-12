// test-1374-letters.js
//
// #1374. Notice-board letters and the Raven Rock board, as
// docs/systems/noticeboards.md has them.
//
// A letter is a job with a named person at the other end, written at the
// board. It costs 35 up front: 20 is the board's fee and stays on the hold's
// ledger, 15 is the courier's pay, held on the same ledger. The courier does
// not read it: the wall, the panels, Your jobs and the taking line name who it is
// for, never the words. /deliver, within the trade reach of 700, to the named
// person, hands them the words and pays the courier the 15 out of the ledger.
// The 15 is the sender's gold moved, never created, so packs plus ledger add
// up to the same through the whole of it. /unpin before delivery gives the 15
// back and keeps the fee. There is no courier cooldown.
//
// Ten boards, one per town: Raven Rock's starts at its inn, The Retching
// Netch, until a steward walks it, and a later seeding never puts a walked
// board back.
//
// The real functions, lifted out of the property block in game/gamemode.js
// and run over a pretend engine. Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(path.join(REPO_DIR, p), 'utf8').split(CR).join(''); };
const gm = read('game/gamemode.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e), false); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const prop = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('the property block is in the gamemode', prop !== null);

/* One function out of the property block, by name, once. */
function fn(name) {
  if (!prop) { return null; }
  const head = '\n  function ' + name + '(';
  const a = prop.indexOf(head);
  if (a < 0 || prop.indexOf(head, a + 1) >= 0) { return null; }
  const b = prop.indexOf('\n  }\n', a + 1);
  return b < 0 ? null : prop.slice(a + 1, b + 4);
}

const NAMES = ['takeGold', 'payOut', 'payHeld', 'sealed', 'nameIs', 'postWords', 'post', 'board', 'take',
               'jobsOf', 'dropJob', 'takedown', 'unpin', 'postLetter', 'deliver', 'letterReach',
               'boardHere', 'nearestBoard', 'wallOf', 'boardPanel', 'boardsView', 'moveBoard', 'command',
               // The panel also lists the towns a haul can go to and the hauls that came here (#1393).
               'haulTenth'];
const lifted = {};
const missing = [];
NAMES.forEach(function (n) { lifted[n] = fn(n); if (!lifted[n]) { missing.push(n); } });
yes('every piece of the board and the letter is in the property block, once' +
    (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);

const fees = prop ? slice(prop, '  var NOTICE_FEE = ', 'var LETTER_REACH = 700;') : null;
yes('the fees and the letter numbers sit together', fees !== null);
const seeding = prop ? (function () {
  const a = prop.indexOf('  var BOARD_REACH = 400;');
  const b = prop.indexOf('  /** The hold whose board somebody is standing at', a);
  return (a < 0 || b < 0) ? null : prop.slice(a, b);
})() : null;
yes('the board seeding is in the property block', seeding !== null);
const holds = prop ? slice(prop, '  var LEDGER_HOLDS = [', '];') : null;
// The company's cut of a haul is its terms now (#512, #2695), read by the company terms block.
const COMPANY = require('./fixtures/company-block').companyApi(gm);
const PACK_FIRST = require('./fixtures/pack-first');
yes('the ten ledgers are in the property block, and the company\'s terms are in the gamemode', holds !== null && !!COMPANY);

// The real chargen town table, which is where nine of the boards come from.
const chargenLine = gm.split('\n').find(function (l) { return l.indexOf('const CHARGEN = ') === 0; });
const PASSAGES = chargenLine ? JSON.parse(chargenLine.slice('const CHARGEN = '.length).replace(/;$/, '')).towns : null;
yes('the chargen town table reads', !!PASSAGES && Object.keys(PASSAGES).length === 9);

function num(re) { const m = re.exec(gm); return m ? Number(m[1]) : NaN; }
const NOTICE_FEE = num(/var NOTICE_FEE = (\d+);/);
const JOB_FEE = num(/var JOB_FEE = (\d+);/);
const LETTER_FEE = num(/var LETTER_FEE = (\d+);/);
const LETTER_PAY = num(/var LETTER_PAY = (\d+);/);
yes('the fees are the page\'s: 20 for a notice, 30 for a job, 35 for a letter with its 15 courier pay',
    NOTICE_FEE === 20 && JOB_FEE === 30 && LETTER_FEE + LETTER_PAY === 35 && LETTER_PAY === 15);
yes('the letter is 300 characters and the delivery reach is the trade\'s 700',
    /var LETTER_CHARS = 300;/.test(gm) && /var LETTER_REACH = 700;/.test(gm) &&
    /reach: 700,/.test(slice(gm, '// ==== thornswood trade ====', '// ==== end thornswood trade ====') || ''));

const GOLD = 15;
const TAMRIEL = '3c:Skyrim.esm';
// Whiterun's and Riften's boards stand inside their walled cities (#2516).
const WHITERUN_WORLD = '1a26f:Skyrim.esm';
const RIFTEN_WORLD = '16bb4:Skyrim.esm';
const NETCH = '17ec0:Dragonborn.esm';
const WHITERUN = [23139.4, -7891.7, -3494.4];

/* The engine: packs, names and places, kept across a restart. */
function world() {
  const people = {};
  return {
    people: people,
    add: function (p) {
      people[p.actor] = { pid: p.pid, name: p.name, cell: p.cell || WHITERUN_WORLD,
                          pos: (p.pos || WHITERUN).slice(), pack: [{ baseId: GOLD, count: p.gold }] };
      return p;
    },
    move: function (p, cell, pos) { people[p.actor].cell = cell; people[p.actor].pos = pos.slice(); },
    gold: function (p) {
      return people[p.actor].pack.reduce(function (s, e) { return s + (e.baseId === GOLD ? e.count : 0); }, 0);
    },
    mp: PACK_FIRST.receipts({
      get: function (id, key) {
        const p = people[id];
        if (!p) { return undefined; }
        if (key === 'inventory') { return { entries: JSON.parse(JSON.stringify(p.pack)) }; }
        if (key === 'appearance') { return { name: p.name }; }
        if (key === 'worldOrCellDesc') { return p.cell; }
        if (key === 'pos') { return p.pos.slice(); }
        if (key === 'profileId') { return p.pid; }
        return undefined;
      },
      set: function (id, key, v) {
        if (key === 'inventory') { people[id].pack = JSON.parse(JSON.stringify(v.entries)); }
      }
    })
  };
}

/* The social block's three answers, the way it gives them: a hex form id is exact, a name is a prefix. */
function social(w) {
  return {
    findPerson: function (want) {
      const ids = Object.keys(w.people).map(Number);
      const hex = parseInt(want, 16);
      if (isFinite(hex) && hex > 0 && ids.indexOf(hex) !== -1) { return { actorId: hex, why: '' }; }
      const low = String(want).toLowerCase();
      const hit = ids.filter(function (id) { return w.people[id].name.toLowerCase().indexOf(low) === 0; });
      if (hit.length === 1) { return { actorId: hit[0], why: '' }; }
      return { actorId: 0, why: hit.length ? 'More than one person here answers to that.' : 'Nobody here by that name.' };
    },
    nameOfPerson: function (id) { return w.people[id] ? w.people[id].name : 'somebody'; },
    profileOf: function (id) { return w.people[id] ? w.people[id].pid : 0; }
  };
}

/* One boot of the board over a register object. A restart is a second boot over the same register. */
function boot(reg, w, opts) {
  opts = opts || {};
  const block = opts.seeding || seeding;
  const body = [
    'var boxes = {};',
    'var funds = loadPart("funds", {});',
    'var notices = loadPart("notices", {});',
    'var GOLD_ID = ' + GOLD + ';',
    'var boardReads = {};',
    holds,
    fees,
    block,
    'function save() { reg.funds = JSON.parse(JSON.stringify(funds)); ' +
    'reg.notices = JSON.parse(JSON.stringify(notices)); reg.boards = JSON.parse(JSON.stringify(boards)); }',
    'function refreshPanel() { }',
    // Nobody guards these boards; a guard's take down (#502) is
    // tests/test-502-guard-board.js. Nobody is a Jarl here either, and the
    // stewards given are stewards of every board here (#2551, a steward is
    // of one hold: tests/test-2551-hold-offices.js).
    'function isGuard() { return false; }',
    'function isJarlOf() { return false; }',
    'function isStewardOf(pid) { return isSteward(pid); }',
    // Every word the property block answers that is not a board's.
    ['deeds', 'setLock', 'mold', 'moldHere', 'cutKey', 'here', 'claim', 'officeCmd',
     'evict', 'boxCmd', 'rentCmd',
     // The server stands the board where a steward moves it (#2516): test-2516-server-boards.js.
     'standBoard'].map(function (n) { return 'function ' + n + '() { return true; }'; }).join('\n')
  ];
  NAMES.forEach(function (n) { body.push(lifted[n]); });
  // A post takes out of the pack through packFirst (#4901): tests/fixtures/pack-first.js.
  body.push(PACK_FIRST.pieces(prop));
  body.push('return { boards: boards, funds: function () { return funds; }, ' +
            'notices: function () { return notices; }, command: command, boardPanel: boardPanel, ' +
            'boardsView: boardsView, ' +
            'nameIs: nameIs, seed: BOARD_SEED };');
  const g = { __thornswoodSocial: social(w), __thornswoodTrade: { TRADE: { reach: 700 } }, __thornswoodCompany: COMPANY };
  const make = new Function('reg', 'mp', 'plog', 'loadPart', 'PASSAGES', 'g', 'isSteward', body.join('\n'));
  const api = make(reg, w.mp, function () { },
                   function (key, fallback) {
                     return Object.prototype.hasOwnProperty.call(reg, key)
                       ? JSON.parse(JSON.stringify(reg[key])) : fallback;
                   },
                   PASSAGES, g, function (pid) { return (opts.stewards || []).indexOf(pid) !== -1; });
  api.told = {};
  api.say = function (p, line) {
    const parts = line.trim().split(/\s+/);
    const said = [];
    const to = function (pid, m) {
      (api.told[pid] = api.told[pid] || []).push(m);
      if (pid === p.pid) { said.push(m); }
    };
    const answered = api.command(parts[0].toLowerCase(), parts, p.actor, p.pid, to);
    return answered ? said.join('\n') : null;
  };
  return api;
}

const ALICE = { actor: 0xff000101, pid: 101, name: 'Alice', gold: 200 };
const BOB = { actor: 0xff000102, pid: 102, name: 'Bob', gold: 10 };
const LYDIA = { actor: 0xff000103, pid: 103, name: 'Lydia Stormblade', gold: 0 };
const CYRUS = { actor: 0xff000104, pid: 104, name: 'Cyrus', gold: 50 };
const WORDS = 'Meet me at the Drunken Huntsman at dusk. Bring the ring.';

function total(w, s) {
  let n = 0;
  [ALICE, BOB, LYDIA, CYRUS].forEach(function (p) { if (w.people[p.actor]) { n += w.gold(p); } });
  const f = s.funds();
  for (const k in f) { n += Number(f[k]) || 0; }
  return n;
}

if (missing.length === 0 && fees && seeding && PASSAGES) {
  // ------------------------------------------------------------ ten boards
  attempt('the ten boards', function () {
    const w = world();
    const s = boot({}, w);
    const keys = Object.keys(s.boards).sort();
    yes('B1 a fresh server has ten boards, one per town',
        keys.join(',') === 'dawnstar,falkreath,markarth,morthal,ravenrock,riften,solitude,whiterun,windhelm,winterhold');
    const rr = s.boards.ravenrock;
    yes('B1 Raven Rock\'s is at its inn, The Retching Netch, at Geldis Sadri\'s spot',
        rr.cell === NETCH && Math.abs(rr.pos[0] + 39) < 1 && Math.abs(rr.pos[1] + 178.2) < 1 && rr.pos[2] === 0 &&
        rr.where === 'Raven Rock' && rr.seed === s.seed);
    yes('B1 and the nine mainland boards are still Djinn\'s outdoor spots',
        s.boards.whiterun.cell === WHITERUN_WORLD && s.boards.whiterun.pos[0] === 23139.4);

    // A server that has been played on, with the nine already saved and no Raven Rock.
    const nine = JSON.parse(JSON.stringify(s.boards));
    delete nine.ravenrock;
    const s2 = boot({ boards: nine }, w);
    yes('B2 a server with nine saved boards gains Raven Rock\'s on the next start',
        !!s2.boards.ravenrock && s2.boards.ravenrock.cell === NETCH && Object.keys(s2.boards).length === 10);
  });

  attempt('a steward walks Raven Rock\'s board', function () {
    const w = world();
    const STEW = w.add({ actor: 0xff000110, pid: 110, name: 'Steward', gold: 0,
                         cell: '800:Dragonborn.esm', pos: [-1000, 2000, 50] });
    const reg = {};
    let s = boot(reg, w, { stewards: [110] });
    const nobody = w.add({ actor: 0xff000111, pid: 111, name: 'Nobody', gold: 0,
                           cell: '800:Dragonborn.esm', pos: [-1000, 2000, 50] });
    const refused = s.say(nobody, '/board move ravenrock');
    yes('W1 somebody who is not a steward cannot move it', /Only a steward/.test(refused) &&
        s.boards.ravenrock.cell === NETCH);
    const typo = s.say(STEW, '/board move ravenrok');
    yes('W2 a name that is not one of the ten boards is refused, and no eleventh board appears',
        /No board in ravenrok/.test(typo) && Object.keys(reg.boards || s.boards).length === 10 &&
        !Object.prototype.hasOwnProperty.call(s.boards, 'ravenrok'));
    const moved = s.say(STEW, '/board move ravenrock');
    yes('W3 a steward moves it to where they stand', /ravenrock's board is here now/.test(moved) &&
        reg.boards.ravenrock.cell === '800:Dragonborn.esm' && reg.boards.ravenrock.pos[0] === -1000 &&
        !!reg.boards.ravenrock.placed && reg.boards.ravenrock.where === 'Raven Rock');
    // #1597: every client is told where the board is now, cell and all, and puts its object there.
    const told = s.boardsView(STEW.pid).list.filter(function (t) { return t.hold === 'ravenrock'; })[0];
    yes('W3 and the boards every client is sent say Solstheim and the new point, for the object',
        !!told && told.cell === '800:Dragonborn.esm' && told.x === -1000 && told.y === 2000 && told.z === 50);

    s = boot(reg, w);
    yes('W4 a restart keeps the walked spot', s.boards.ravenrock.cell === '800:Dragonborn.esm' &&
        s.boards.ravenrock.pos[0] === -1000);

    // The next seeding: the number goes up, every seeded board follows, a walked one does not.
    const next = seeding.replace(/var BOARD_SEED = (\d+);/, function (m, n) { return 'var BOARD_SEED = ' + (Number(n) + 1) + ';'; });
    const s3 = boot(JSON.parse(JSON.stringify(reg)), w, { seeding: next });
    yes('W5 a later seeding does not put a walked board back',
        s3.seed === s.seed + 1 && s3.boards.ravenrock.cell === '800:Dragonborn.esm' &&
        s3.boards.ravenrock.pos[0] === -1000);
    yes('W5 while the boards nobody walked take the new seeding',
        s3.boards.whiterun.seed === s3.seed && s3.boards.riften.seed === s3.seed);
    const unwalked = JSON.parse(JSON.stringify(reg));
    unwalked.boards.ravenrock = { cell: NETCH, pos: [5, 5, 5], where: 'Raven Rock', seed: s.seed };
    const s4 = boot(unwalked, w, { seeding: next });
    yes('W6 and an unwalked Raven Rock board does follow a new seeding back to the inn spot',
        s4.boards.ravenrock.cell === NETCH && s4.boards.ravenrock.pos[0] === -39 &&
        s4.boards.ravenrock.seed === s4.seed);
  });

  attempt('a letter at Raven Rock\'s inn', function () {
    const w = world();
    const at = { actor: 0xff000120, pid: 120, name: 'Neloth', gold: 100, cell: NETCH, pos: [-60, -150, 0] };
    w.add(at);
    const s = boot({}, w);
    const said = s.say(at, '/letter Lydia ' + WORDS);
    yes('R1 a letter can be written at Raven Rock\'s board',
        /on the board in ravenrock/.test(said) && w.gold(at) === 65 && s.funds().ravenrock === 35);
    w.move(at, '16a0e:Skyrim.esm', [-60, -150, 0]);
    yes('R2 the same coordinates in another interior are not Raven Rock\'s board',
        /Stand at a hold's notice board/.test(s.say(at, '/letter Lydia hello')) && w.gold(at) === 65);
  });

  // ------------------------------------------------------------- a letter
  attempt('a letter, start to finish', function () {
    const w = world();
    [ALICE, BOB, LYDIA, CYRUS].forEach(w.add);
    const reg = {};
    let s = boot(reg, w);
    const start = total(w, s);

    w.move(ALICE, TAMRIEL, [0, 0, 0]);
    let said = s.say(ALICE, '/letter Lydia ' + WORDS);
    yes('P1 away from a board a letter is refused and nothing is taken',
        /Stand at a hold's notice board/.test(said) && w.gold(ALICE) === 200);
    w.move(ALICE, WHITERUN_WORLD, WHITERUN);

    said = s.say(ALICE, '/letter');
    yes('P2 a letter with no name is refused', /Say who the letter is for/.test(said) && w.gold(ALICE) === 200);
    said = s.say(ALICE, '/letter Lydia');
    yes('P2 and one with no words', /Say what the letter says/.test(said) && w.gold(ALICE) === 200);
    said = s.say(ALICE, '/letter Lydia ' + 'x'.repeat(301));
    yes('P3 a letter over 300 characters is refused before any gold is taken',
        /up to 300 characters/.test(said) && w.gold(ALICE) === 200 && !(s.notices().whiterun || []).length);

    said = s.say(ALICE, '/letter Lydia ' + WORDS);
    yes('P4 a letter goes up for 35, 20 for the board and 15 held for the courier',
        /That cost 35 gold: 20 for the board, and 15 held/.test(said) && w.gold(ALICE) === 165);
    yes('P4 and all 35 is counted on the hold\'s ledger', s.funds().whiterun === 35);
    const n = s.notices().whiterun[0];
    yes('P4 it is a job with a named person at the other end',
        n.job === true && n.letter === true && n.to === 'Lydia' && n.pay === 15 && n.text === WORDS);
    yes('P4 and the total of packs and ledger has not moved', total(w, s) === start);

    // The wall, on J and on the panel.
    const where = s.say(CYRUS, '/board');
    yes('P5 /board on its own puts nothing in the chat but where the boards are',
        /J, under Boards/.test(where) && where.indexOf('Lydia') === -1);
    const quiet = s.say(CYRUS, '/board whiterun');
    const onJ = s.boardsView(CYRUS.pid);
    yes('P5 J\'s Boards tab says it is a letter and who it is for, and not the words',
        quiet === '' && onJ.read.hold === 'whiterun' && onJ.read.wall.length === 1 &&
        onJ.read.wall[0].letter === true && onJ.read.wall[0].name === 'Alice' &&
        onJ.read.wall[0].text === 'A sealed letter for Lydia' && JSON.stringify(onJ).indexOf('Drunken') === -1);
    const panel = s.boardPanel(CYRUS.actor, CYRUS.pid);
    yes('P6 the panel marks it a letter for Lydia and does not carry the words',
        panel && panel.wall.length === 1 && panel.wall[0].letter === true && panel.wall[0].job === true &&
        panel.wall[0].text === 'A sealed letter for Lydia' && JSON.stringify(panel).indexOf('Drunken') === -1);

    // Taking it.
    said = s.say(ALICE, '/take 1');
    yes('T1 the sender cannot carry their own letter', /your own/.test(said) && !s.notices().whiterun[0].taken);
    said = s.say(BOB, '/take 1');
    yes('T2 a courier takes it, and is not told the words',
        /You take the letter for Lydia, from Alice. It is sealed/.test(said) && said.indexOf('Drunken') === -1 &&
        s.notices().whiterun[0].taken === BOB.pid);
    said = s.say(CYRUS, '/take 1');
    yes('T3 one taker', /Bob has that one/.test(said));
    s.say(BOB, '/board riften');
    const list = s.boardsView(BOB.pid).jobs;
    yes('T4 the courier\'s Your jobs on J names who it is for and from whom, not the words',
        list.length === 1 && list[0].letter === true && list[0].text === 'A sealed letter for Lydia' &&
        list[0].name === 'Alice' && list[0].hold === 'whiterun' && JSON.stringify(list).indexOf('Drunken') === -1);
    const held = s.boardPanel(BOB.actor, BOB.pid);
    yes('T4 and so does the panel\'s list of what they carry',
        held.jobs.length === 1 && held.jobs[0].text === 'A sealed letter for Lydia' &&
        JSON.stringify(held).indexOf('Drunken') === -1);
    said = s.say(ALICE, '/unpin 1');
    yes('T5 the sender cannot take it down while it is being carried',
        /has taken that job/.test(said) && !s.notices().whiterun[0].down && w.gold(ALICE) === 165);

    // A restart in the middle.
    s = boot(reg, w);
    yes('T6 after a restart the letter is still carried and the 15 still held',
        s.notices().whiterun[0].taken === BOB.pid && s.notices().whiterun[0].pay === 15 &&
        s.funds().whiterun === 35);

    // Delivering it.
    yes('D1 somebody carrying nothing has nothing to deliver',
        /not carrying a letter/.test(s.say(CYRUS, '/deliver Lydia')));
    w.move(BOB, WHITERUN_WORLD, [WHITERUN[0] + 300, WHITERUN[1], WHITERUN[2]]);
    w.move(LYDIA, WHITERUN_WORLD, [WHITERUN[0] + 1200, WHITERUN[1], WHITERUN[2]]);
    w.move(CYRUS, WHITERUN_WORLD, [WHITERUN[0] + 400, WHITERUN[1], WHITERUN[2]]);
    yes('D2 /deliver with nobody named points at the look prompt',
        /Look at the person the letter is for, and use the key the prompt shows/.test(s.say(BOB, '/deliver')));
    said = s.say(BOB, '/deliver Cyrus');
    yes('D3 a wrong person is refused, and the letter stays with the courier',
        /That is Cyrus. What you carry is for Lydia/.test(said) && !s.notices().whiterun[0].down &&
        w.gold(BOB) === 10 && (s.told[CYRUS.pid] || []).join(' ').indexOf('Drunken') === -1);
    yes('D4 handing it to yourself is refused', /That is you/.test(s.say(BOB, '/deliver Bob')));
    said = s.say(BOB, '/deliver Lydia');
    yes('D5 the named person 900 units away is out of reach, and nothing moves',
        /Stand closer/.test(said) && w.gold(BOB) === 10 && !s.notices().whiterun[0].down);
    w.move(LYDIA, '1605e:Skyrim.esm', [WHITERUN[0] + 400, WHITERUN[1], WHITERUN[2]]);
    yes('D6 so is somebody with the same coordinates in another cell',
        /Stand closer/.test(s.say(BOB, '/deliver Lydia')) && w.gold(BOB) === 10);
    w.move(LYDIA, WHITERUN_WORLD, [WHITERUN[0] + 990, WHITERUN[1], WHITERUN[2]]);
    said = s.say(BOB, '/deliver ' + LYDIA.actor.toString(16));
    yes('D7 within 700 the named person, by the form id the crosshair gives, gets the letter',
        /You hand Lydia Stormblade the letter. 15 gold is yours./.test(said));
    const heard = (s.told[LYDIA.pid] || []).join('\n');
    yes('D7 she is handed the words, who wrote them and who brought them',
        heard.indexOf(WORDS) !== -1 && heard.indexOf('from Alice') !== -1 && heard.indexOf('by Bob') !== -1);
    yes('D8 the courier is paid the 15 the sender put up', w.gold(BOB) === 25);
    yes('D8 the ledger keeps the 20 fee and the 15 has left it', s.funds().whiterun === 20);
    yes('D8 the sender paid 35 and nothing more', w.gold(ALICE) === 165);
    yes('D9 the 15 was moved, not made: packs plus ledger are what they were', total(w, s) === start);
    const done = s.notices().whiterun[0];
    yes('D10 the letter comes off the wall, delivered, and its pay is spent',
        !!done.down && !!done.delivered && done.deliveredTo === LYDIA.pid && done.pay === 0);
    s.say(CYRUS, '/board whiterun');
    yes('D10 and nobody reads it on the wall afterwards', s.boardsView(CYRUS.pid).read.wall.length === 0);
    yes('D11 it cannot be delivered twice', /not carrying a letter/.test(s.say(BOB, '/deliver Lydia')) &&
        w.gold(BOB) === 25);
    yes('D11 nor handed back, nor taken down for a refund',
        /not one of yours/.test(s.say(BOB, '/dropjob 1')) &&
        /already down/.test(s.say(ALICE, '/unpin 1')) && w.gold(ALICE) === 165 && s.funds().whiterun === 20);
    s.say(BOB, '/board whiterun');
    yes('D12 the courier\'s list is empty again', s.boardsView(BOB.pid).jobs.length === 0);
    s = boot(reg, w);
    yes('D13 after a restart the delivery and the ledger stand',
        !!s.notices().whiterun[0].delivered && s.funds().whiterun === 20 && s.notices().whiterun[0].pay === 0);
  });

  attempt('the sender takes it back down', function () {
    const w = world();
    [ALICE, BOB, LYDIA, CYRUS].forEach(w.add);
    const s = boot({}, w);
    const start = total(w, s);
    s.say(ALICE, '/letter "Lydia Stormblade" ' + WORDS);
    s.say(ALICE, '/letter Cyrus A second one, straight after.');
    yes('U1 the name can be several words in double quotes',
        s.notices().whiterun[0].to === 'Lydia Stormblade' && s.notices().whiterun[0].text === WORDS);
    yes('U2 there is no cooldown: a second letter goes straight up',
        s.notices().whiterun.length === 2 && w.gold(ALICE) === 130 && s.funds().whiterun === 70);
    s.say(BOB, '/take 1');
    const back = s.say(BOB, '/dropjob 1');
    yes('U3 /dropjob puts the letter back on the board',
        /put it back/.test(back) && !s.notices().whiterun[0].taken);
    yes('U4 only the sender takes it down', /not yours/.test(s.say(CYRUS, '/unpin 1')));
    const down = s.say(ALICE, '/unpin 1');
    yes('U5 /unpin before delivery returns the 15 and keeps the fee',
        /The 15 gold for the courier comes back to you. The fee stays with whiterun/.test(down) &&
        w.gold(ALICE) === 145 && s.funds().whiterun === 55);
    yes('U5 and the letter is down with nothing left held', !!s.notices().whiterun[0].down &&
        s.notices().whiterun[0].pay === 0);
    yes('U6 a second /unpin pays nothing', /already down/.test(s.say(ALICE, '/unpin 1')) && w.gold(ALICE) === 145);
    yes('U7 packs plus ledger are what they were', total(w, s) === start);
    yes('U8 a notice taken down still pays nothing back',
        (function () {
          s.say(ALICE, '/notice Room to let :: Above the smithy.');
          const before = w.gold(ALICE);
          s.say(ALICE, '/unpin 3');
          return w.gold(ALICE) === before && !!s.notices().whiterun[2].down;
        })());
  });

  attempt('the fee is the same for everybody', function () {
    const w = world();
    const poor = w.add({ actor: 0xff000130, pid: 130, name: 'Poor', gold: 34 });
    const s = boot({}, w);
    yes('F1 34 gold does not buy a letter, and nothing is taken or posted',
        /A letter costs 35 gold and you do not have it/.test(s.say(poor, '/letter Lydia hi')) &&
        w.gold(poor) === 34 && !(s.notices().whiterun || []).length && !s.funds().whiterun);
    yes('F2 a notice is 20',
        /cost 20 gold/.test(s.say(poor, '/notice hi :: hello')) && w.gold(poor) === 14);
    // A job is 30 and its reward (#2554): 14 gold buys neither, and nothing is taken.
    yes('F3 a job is 30 and its reward, and 14 gold does not buy one',
        /costs 31 gold, 30 for the board and the 1 reward/.test(s.say(poor, '/job 1 a job :: do it')) && w.gold(poor) === 14);
  });

  {
    const s = boot({}, world());
    yes('N1 a name matches the whole character name', s.nameIs('lydia stormblade', 'Lydia Stormblade'));
    yes('N1 or its first word', s.nameIs('Lydia', 'Lydia Stormblade'));
    yes('N1 and a part of a word reaches nobody', !s.nameIs('Ly', 'Lydia Stormblade') && !s.nameIs('Stormblade', 'Lydia Stormblade'));
  }
}

// ------------------------------------------------------- where it is wired
{
  function list(name) {
    const m = new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];').exec(gm);
    return m ? m[1] : '';
  }
  yes('the server answers /letter and /deliver, which the board panel and the look prompt send, and no help names them (#1595)',
      /'\/letter', '\/deliver'/.test(list('WORDS')) && list('PLAYER_WORDS').indexOf("'/letter'") === -1 &&
      list('PLAYER_WORDS').indexOf("'/deliver'") === -1);
  yes('the chat hands both to the property block with the other board words',
      /word === '\/letter' \|\| word === '\/deliver' \|\|\s*word === '\/dropjob' \|\| word === '\/unpin'\) \{/.test(gm));
  yes('the property block answers both',
      /if \(word === '\/letter'\) \{ return postLetter\(/.test(prop || '') &&
      /if \(word === '\/deliver'\) \{ return deliver\(/.test(prop || ''));
}

// ------------------------------------------------------------- the data
{
  const doors = JSON.parse(read('game/data/doors.json'));
  const cell = doors.cells && doors.cells[NETCH];
  yes('the inn is vanilla Raven Rock\'s one inn, The Retching Netch, in doors.json',
      !!cell && cell.name === 'The Retching Netch' && cell.edid === 'DLC2RRTheRetchingNetch' && cell.interior === true);
  const traders = JSON.parse(read('game/data/merchant-traders.json'));
  const geldis = traders.byRef['18291:Dragonborn.esm'];
  const source = JSON.parse(read('game/data/npc-population.json')).npcs.find(row => row.ref === '18291:Dragonborn.esm');
  yes('the spot is the retained Cook, originally Geldis Sadri, at the same inn coordinates',
      !!geldis && !!source && source.name === 'Geldis Sadri' && geldis.name === 'Cook' &&
      geldis.cell === NETCH && Math.round(Number(geldis.pos[0])) === -39 && Math.round(Number(geldis.pos[1])) === -178);
  const sites = JSON.parse(read('game/data/guild-sites.json')).sites;
  const rr = sites.filter(function (x) { return x.bookHold === 'ravenrock'; })[0];
  yes('and it is the spot Raven Rock\'s guild site already names', !!rr && rr.cell === NETCH &&
      Math.round(rr.x) === -39 && Math.round(rr.y) === -178);
}

// ------------------------------------------------------ the client's half
{
  const front = read('game/plugins/thornswood-front.js');
  const press = slice(front, '  function boardPress(e) {', '\n  }\n') || '';
  // Since #2298 only the board object itself opens the board, so a person or
  // an NPC under the crosshair (Geldis Sadri) answers E themselves.
  // Since #2516 the server answers E on its own board reference, so a person
  // or an NPC beside it (Geldis Sadri) answers E themselves.
  const gmAll = read('game/gamemode.js');
  yes('pressing E on a person or an NPC by a board answers them, so Geldis Sadri still trades',
      press === '' && gmAll.indexOf('propBoard.boardActivated(refrId, casterRefrId)') > 0);
  const page = read('game/ui/thornswood-board.js');
  yes('the board panel calls a letter a letter', page.indexOf("row.letter ? 'Letter'") !== -1);
}

// ------------------------------------------------------------- the page
{
  const doc = read('docs/systems/noticeboards.md');
  yes('the page no longer says letters do not exist',
      doc.indexOf('do not exist') === -1 && doc.indexOf('A courier is not paid') === -1);
  yes('the page names Raven Rock\'s inn and says ten boards are seeded',
      doc.indexOf('The Retching Netch') !== -1 && doc.indexOf('Ten boards are seeded') !== -1);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
