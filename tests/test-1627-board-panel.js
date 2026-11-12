// test-1627-board-panel.js
//
// #1627. Reading a board, any town's board, and your own jobs are a panel,
// not /board and /jobs, and nobody is told to type the lines the board panel
// sends. Patrick, 4 Oct: "no more commands for things [people] do, only for
// dev and staff commands; everything else takes buttons and GUI".
//
// The question on the issue, built as its suggested answer: J has a Boards
// tab with the ten towns, the one picked shows that town's wall read only,
// and Your jobs is under it. Picking a town sends /board <town>, which puts
// that board in the social view (boardsView) and says nothing in the chat.
// The board panel shows Your jobs, every job taken in every town, with Put
// it back on the rows of the board you stand at, and the line that counts
// the older ones.
//
// Done when: nobody types anything to read a board, any town's board or
// their own jobs, or to post, take, take down or hand back a job; the words
// are gone from the list named to everybody, the /help topics and the pages;
// and the server's own answers stop telling people to type one.
//
// The real functions, lifted out of the property block in game/gamemode.js
// and run over a pretend engine. Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(path.join(REPO_DIR, p), 'utf8').split(CR).join(''); };
const gm = process.env.GM ? fs.readFileSync(process.env.GM, 'utf8').split(CR).join('') : read('game/gamemode.js');
/*
  One topic of the help panel (#1633), as a fresh install reads it: /help's
  topics moved out of the gamemode into game/ui/thornswood-help.js, each a
  list of paragraphs made from the key names.
*/
function helpTopic(id) {
  const page = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-help.js'), 'utf8')
    .split(String.fromCharCode(13)).join('');
  const a = page.indexOf('  var TOPICS = [');
  const b = a < 0 ? -1 : page.indexOf('\n  ];\n', a);
  const k = /var keys = (\{[\s\S]*?\});/.exec(page);
  if (a < 0 || b < 0 || !k) { return ''; }
  try {
    const topics = new Function('return ' + page.slice(page.indexOf('[', a), b + 4))();
    const t = topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.text(new Function('return ' + k[1])()).join(' ') : '';
  } catch (e) { return ''; }
}

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
/* Code with its comments taken out, so a word in a comment is not a word said to anybody. */
function code(src) {
  return String(src || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');
}

// The board words this issue takes out of everybody's sight.
const BOARD_WORDS = ['/board', '/jobs', '/notice', '/job', '/take', '/unpin', '/dropjob'];
const NAMES_A_WORD = /\/(board|jobs|notice|job|take|unpin|dropjob)\b/;

const prop = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
const social = slice(gm, '// ==== thornswood social:', '// ==== end thornswood social ====');
const chat = slice(gm, '// ==== thornswood chat commands ====', '// ==== end thornswood chat commands ====');
const character = slice(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
yes('the property, social, chat and character blocks are in the gamemode', !!prop && !!social && !!chat && !!character);
if (!prop || !social || !chat || !character) { done(); }

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
               'haulTenth', 'haulText'];
const lifted = {};
const missing = [];
NAMES.forEach(function (n) { lifted[n] = fn(n); if (!lifted[n]) { missing.push(n); } });
yes('every piece of the board is in the property block, once' +
    (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);
yes('the typed /jobs reader is gone: there is no function jobs( in the property block',
    prop.indexOf('\n  function jobs(') === -1);

const fees = slice(prop, '  var NOTICE_FEE = ', 'var LETTER_REACH = 700;');
const holds = slice(prop, '  var LEDGER_HOLDS = [', '];');
// The company's cut of a haul is its terms now (#512, #2695), read by the company terms block.
const COMPANY = require('./fixtures/company-block').companyApi(gm);
const PACK_FIRST = require('./fixtures/pack-first');
const reads = slice(prop, '  var boardReads = ', ';');
const seeding = (function () {
  const a = prop.indexOf('  var BOARD_REACH = 400;');
  const b = prop.indexOf('  /** The hold whose board somebody is standing at', a);
  return (a < 0 || b < 0) ? null : prop.slice(a, b);
})();
yes('the fees, the ten ledgers, the board seeding and what each character is reading are in the block',
    !!fees && !!holds && !!COMPANY && !!seeding && reads === '  var boardReads = {};');
const chargenLine = gm.split('\n').find(function (l) { return l.indexOf('const CHARGEN = ') === 0; });
const PASSAGES = chargenLine ? JSON.parse(chargenLine.slice('const CHARGEN = '.length).replace(/;$/, '')).towns : null;
yes('the chargen town table reads', !!PASSAGES);
if (missing.length || !fees || !holds || !COMPANY || !seeding || !reads || !PASSAGES) { done(); }

const GOLD = 15;
const TAMRIEL = '3c:Skyrim.esm';
// Whiterun's and Riften's boards stand inside their walled cities (#2516).
const WHITERUN_WORLD = '1a26f:Skyrim.esm';
const RIFTEN_WORLD = '16bb4:Skyrim.esm';
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

/* One boot of the board over a register object. A restart is a second boot over the same register. */
function boot(reg, w) {
  const pushed = [];
  const body = [
    'var boxes = {};',
    'var funds = loadPart("funds", {});',
    'var notices = loadPart("notices", {});',
    'var GOLD_ID = ' + GOLD + ';',
    reads,
    holds,
    fees,
    seeding,
    'function save() { reg.funds = JSON.parse(JSON.stringify(funds)); ' +
    'reg.notices = JSON.parse(JSON.stringify(notices)); reg.boards = JSON.parse(JSON.stringify(boards)); }',
    'function refreshPanel(actorId) { pushed.push(actorId); }',
    // Nobody guards these boards; a guard's take down (#502) is
    // tests/test-502-guard-board.js. Nobody is a Jarl here either, and the
    // stewards given are stewards of every board here (#2551, a steward is
    // of one hold: tests/test-2551-hold-offices.js).
    'function isGuard() { return false; }',
    'function isJarlOf() { return false; }',
    'function isStewardOf(pid) { return isSteward(pid); }',
    'function cancelHaul() { return true; }',
    'function haulCmd() { return true; }',
    ['deeds', 'setLock', 'mold', 'moldHere', 'cutKey', 'here', 'claim', 'officeCmd',
     'evict', 'boxCmd', 'rentCmd', 'sleepHere'].map(function (n) { return 'function ' + n + '() { return true; }'; }).join('\n')
  ];
  NAMES.forEach(function (n) { body.push(lifted[n]); });
  // A post takes out of the pack through packFirst (#4901): tests/fixtures/pack-first.js.
  body.push(PACK_FIRST.pieces(prop));
  body.push('return { boards: boards, funds: function () { return funds; }, ' +
            'notices: function () { return notices; }, command: command, boardPanel: boardPanel, ' +
            'boardsView: boardsView, wallOf: wallOf, jobsOf: jobsOf };');
  const g = { __thornswoodSocial: {}, __thornswoodTrade: { TRADE: { reach: 700 } }, __thornswoodCompany: COMPANY };
  const make = new Function('reg', 'mp', 'plog', 'loadPart', 'PASSAGES', 'g', 'isSteward', 'pushed', body.join('\n'));
  const api = make(reg, w.mp, function () { },
                   function (key, fallback) {
                     return Object.prototype.hasOwnProperty.call(reg, key)
                       ? JSON.parse(JSON.stringify(reg[key])) : fallback;
                   },
                   PASSAGES, g, function () { return false; }, pushed);
  api.pushed = pushed;
  api.every = [];
  api.say = function (p, line) {
    const parts = line.trim().split(/\s+/);
    const said = [];
    const to = function (pid, m) { api.every.push(m); if (pid === p.pid) { said.push(m); } };
    const answered = api.command(parts[0].toLowerCase(), parts, p.actor, p.pid, to);
    return answered ? said.join('\n') : null;
  };
  return api;
}

const ALICE = { actor: 0xff000101, pid: 101, name: 'Alice', gold: 1000 };
const BOB = { actor: 0xff000102, pid: 102, name: 'Bob', gold: 100 };
const CYRUS = { actor: 0xff000104, pid: 104, name: 'Cyrus', gold: 100 };
const FAR = [WHITERUN[0] + 50000, WHITERUN[1] + 50000, WHITERUN[2]];

// ------------------------------------------------------------ the words
attempt('the words', function () {
  function arrayOf(name) {
    const m = new RegExp('^const ' + name + ' = (\\[[\\s\\S]*?\\]);$', 'm').exec(gm);
    if (!m) { return null; }
    try { return new Function('return ' + m[1])(); } catch (e) { return null; }
  }
  const WORDS = arrayOf('WORDS');
  const PLAYER_WORDS = arrayOf('PLAYER_WORDS');
  yes('W1 the list named to everybody, which the unknown word reply reads, names no board word',
      !!PLAYER_WORDS && BOARD_WORDS.every(function (x) { return PLAYER_WORDS.indexOf(x) === -1; }) &&
      /'No command called ' \+ word \+ '\. ' \+ helpLine\(profileId\)/.test(chat) &&
      /function helpLine\(profileId\) \{[\s\S]*?PLAYER_WORDS\.join\(', '\)/.test(chat));
  yes('W2 the server still answers the lines the board panel and J send',
      !!WORDS && ['/notice', '/job', '/board', '/take', '/dropjob', '/unpin'].every(function (x) { return WORDS.indexOf(x) !== -1; }));
  yes('W3 /jobs is gone: nothing sends it, so nothing answers it', !!WORDS && WORDS.indexOf('/jobs') === -1 &&
      code(character).indexOf("'/jobs'") === -1 && code(prop).indexOf("'/jobs'") === -1);
  const s = boot({}, world());
  yes('W3 and the property block does not take /jobs', s.say(ALICE, '/jobs') === null);
  yes('W4 the character block still hands the board panel\'s lines to the property block',
      /word === '\/notice' \|\| word === '\/job' \|\|\s*word === '\/board' \|\| word === '\/take' \|\|/.test(character) &&
      /word === '\/dropjob' \|\| word === '\/unpin'\) \{/.test(character));

  // The help is a panel since #1633: every topic, as a fresh install reads it.
  const helpText = ['talking', 'people', 'living', 'work', 'land', 'help'].map(helpTopic).join(' ');
  yes('W5 the help panel names no board word, and says E opens a board and J has every town\'s board',
      helpText.length > 1000 && !NAMES_A_WORD.test(helpText) &&
      /E on a notice board opens it/.test(helpTopic('work')) && /J shows every town's board/.test(helpTopic('work')));

  const pages = ['docs/systems/noticeboards.md', 'docs/systems/trading-company.md', 'docs/systems/gold.md'];
  let named = '';
  pages.forEach(function (p) {
    read(p).split('\n').forEach(function (line, i) {
      // A steward's /board move and /board here are #1638's, and stay until then.
      const left = line.replace(/`\/board (move|here)[^`]*`/g, '');
      if (NAMES_A_WORD.test(left)) { named += ' ' + p + ':' + (i + 1); }
    });
  });
  yes('W6 the pages name no board word for people' + named, named === '');
  const commands = read('docs/systems/commands.md');
  yes('W8 the commands page says nobody is told of them now',
      /\| `\/jobs` \| Nobody \| Gone\./.test(commands) &&
      /Picking a town under Boards on J sends it\. Never in the list or the help\. \| #1627 \|/.test(commands));
});

// ------------------------------------------------------ the server's lines
attempt('the server\'s lines', function () {
  const own = ['post', 'board', 'take', 'jobsOf', 'dropJob', 'unpin', 'wallOf', 'boardPanel', 'boardsView'];
  let told = '';
  own.forEach(function (n) {
    const strings = code(lifted[n]).match(/'(?:[^'\\]|\\.)*'/g) || [];
    strings.forEach(function (str) {
      // A steward's /board here and /board move are #1638's.
      if (/\/board (here|move)/.test(str)) { return; }
      if (NAMES_A_WORD.test(str)) { told += ' ' + n + ': ' + str; }
    });
  });
  yes('S1 no line the board functions say names a board word' + told, told === '');
  yes('S2 "as /board lists them" is gone from the server',
      gm.indexOf('as /board lists them') === -1 && gm.indexOf('/take uses the numbers') === -1);
});

// ------------------------------------------------------------ J's Boards
attempt('J\'s Boards tab', function () {
  const w = world();
  [ALICE, BOB, CYRUS].forEach(w.add);
  const reg = {};
  let s = boot(reg, w);

  const before = s.boardsView(CYRUS.pid);
  const towns = before.list.map(function (t) { return t.hold; }).join(',');
  yes('J1 Boards lists the ten towns, in the ledger\'s order, with their names',
      towns === 'whiterun,solitude,riften,markarth,windhelm,falkreath,morthal,dawnstar,winterhold,ravenrock' &&
      before.list[0].where === 'Whiterun' && before.list[9].where === 'Raven Rock');
  yes('J1 and before a town is picked, nothing is read and no jobs are counted',
      before.read === null && before.jobs === null);

  // A wall in Whiterun: twelve notices, a job, a letter, one taken down.
  // A post has a title and a body, and a job a reward (#2554).
  for (let i = 1; i <= 11; i++) { s.say(ALICE, '/notice Notice ' + i + ' :: Notice number ' + i + '.'); }
  s.say(ALICE, '/job 5 Clear the cellar :: Rats, and a lot of them.');
  s.say(ALICE, '/unpin 11');
  yes('J2 the wall was put up at the board', s.notices().whiterun.length === 12 && !!s.notices().whiterun[10].down);
  s.say(BOB, '/take 12');

  // Cyrus is nowhere near a board.
  w.move(CYRUS, TAMRIEL, FAR);
  const pushedBefore = s.pushed.length;
  const quiet = s.say(CYRUS, '/board whiterun');
  const v = s.boardsView(CYRUS.pid);
  yes('J3 picking Whiterun from far away says nothing in the chat and draws J again',
      quiet === '' && s.pushed.length === pushedBefore + 1 && s.pushed[s.pushed.length - 1] === CYRUS.actor);
  yes('J4 J reads Whiterun\'s wall from anywhere', !!v.read && v.read.hold === 'whiterun' && v.read.where === 'Whiterun');
  const ns = v.read.wall.map(function (r) { return r.n; }).join(',');
  yes('J5 the wall is the newest ten still up, numbered by their real place, with the gap kept',
      ns === '12,10,9,8,7,6,5,4,3,2' && v.read.older === 1);
  yes('J6 a job says who took it', v.read.wall[0].job === true && v.read.wall[0].taken === 'Bob' &&
      v.read.wall[0].title === 'Clear the cellar' && v.read.wall[0].text === 'Rats, and a lot of them.' &&
      v.read.wall[0].reward === 5 && v.read.wall[0].name === 'Alice');

  const where = s.say(CYRUS, '/board');
  yes('J7 /board alone reads nothing into the chat and says where the boards are',
      where === 'Click a notice board to read it. Every town\'s board is on J, under Boards.' &&
      s.boardsView(CYRUS.pid).read.hold === 'whiterun');
  const bad = s.say(CYRUS, '/board whiterum');
  yes('J8 a town with no board is refused and the board being read stays',
      bad === 'No board in whiterum.' && s.boardsView(CYRUS.pid).read.hold === 'whiterun');
  yes('J8 and so are the object\'s own names', s.say(CYRUS, '/board __proto__') === 'No board in __proto__.' &&
      s.say(CYRUS, '/board constructor') === 'No board in constructor.' &&
      s.boardsView(CYRUS.pid).read.hold === 'whiterun');

  // Bob reads another town; his jobs are under it, from every town.
  w.move(BOB, RIFTEN_WORLD, s.boards.riften.pos);
  s.say(ALICE, '/notice nothing :: nothing');   // Alice is still in Whiterun.
  w.move(ALICE, RIFTEN_WORLD, s.boards.riften.pos);
  s.say(ALICE, '/job 5 Guard the gate :: Until the bells.');
  s.say(BOB, '/take 1');
  w.move(BOB, TAMRIEL, FAR);
  s.say(BOB, '/board solitude');
  const bobs = s.boardsView(BOB.pid);
  const jobs = bobs.jobs.map(function (j) { return j.hold + ' ' + j.n + ' ' + j.where; }).sort().join(',');
  yes('J9 Your jobs is under it: every job taken in every town, with the town and the number',
      bobs.read.hold === 'solitude' && bobs.read.wall.length === 0 &&
      jobs === 'riften 1 Riften,whiterun 12 Whiterun');
  yes('J10 each character reads their own board', s.boardsView(CYRUS.pid).read.hold === 'whiterun');
  yes('J11 nobody else\'s jobs are on somebody\'s list', s.boardsView(CYRUS.pid).jobs.length === 0);

  s = boot(reg, w);
  yes('J12 after a restart no town is lit, which is true: nobody has asked this server yet',
      s.boardsView(CYRUS.pid).read === null && s.boardsView(BOB.pid).jobs === null &&
      s.notices().whiterun.length === 13);
});

// --------------------------------------------------------- the board panel
attempt('the board panel', function () {
  const w = world();
  [ALICE, BOB, CYRUS].forEach(w.add);
  const s = boot({}, w);
  s.say(ALICE, '/job 5 Fetch firewood :: Ten logs, split.');
  s.say(BOB, '/take 1');
  for (let i = 1; i <= 11; i++) { s.say(ALICE, '/notice Notice ' + i + ' :: Notice number ' + i + '.'); }
  w.move(ALICE, RIFTEN_WORLD, s.boards.riften.pos);
  s.say(ALICE, '/job 5 Guard the gate :: Until the bells.');
  w.move(BOB, RIFTEN_WORLD, s.boards.riften.pos);
  s.say(BOB, '/take 1');
  w.move(BOB, WHITERUN_WORLD, WHITERUN);

  const panel = s.boardPanel(BOB.actor, BOB.pid);
  yes('P1 the job Bob took is older than the newest ten, so it is not on the wall',
      panel.wall.length === 10 && panel.wall.every(function (r) { return r.n !== 1; }) && panel.older === 2);
  const mine = panel.jobs.map(function (j) { return j.hold + ' ' + j.n; }).sort().join(',');
  yes('P2 Your jobs on the panel still has it, and Riften\'s too, with where each one is',
      mine === 'riften 1,whiterun 1' &&
      panel.jobs.some(function (j) {
        return j.hold === 'riften' && j.where === 'Riften' && j.title === 'Guard the gate' &&
               j.text === 'Until the bells.' && j.reward === 5;
      }));
  const back = s.say(BOB, '/dropjob 1');
  yes('P3 Put it back on that row hands it back at this board', /You put it back on the board/.test(back) &&
      !s.notices().whiterun[0].taken);
  yes('P4 and the one in Riften goes back only at Riften\'s board',
      /Stand at the board you took it from/.test((w.move(BOB, TAMRIEL, FAR), s.say(BOB, '/dropjob 1'))) &&
      s.notices().riften[0].taken === BOB.pid);
  yes('P5 away from a board the panel is not drawn', s.boardPanel(BOB.actor, BOB.pid) === null);

  w.move(CYRUS, WHITERUN_WORLD, WHITERUN);
  const refusals = [s.say(CYRUS, '/take 99'), s.say(CYRUS, '/dropjob 99'), s.say(CYRUS, '/unpin 99'), s.say(CYRUS, '/take x')];
  yes('P6 a number that is not on the board is refused in words that name no command',
      refusals.every(function (r) { return r === 'That one is not on the board.'; }));
  yes('P7 nothing anybody was told names a board word',
      s.every.length > 10 && s.every.every(function (m) { return !NAMES_A_WORD.test(String(m)) || /\/deliver/.test(m); }));
});

// ------------------------------------------------------------- the panels
attempt('the panels', function () {
  const page = read('game/ui/thornswood-board.js');
  const journal = read('game/ui/thornswood-journal.js');
  let parses = true;
  try { new vm.Script(page); new vm.Script(journal); } catch (e) { parses = false; }
  yes('U1 both pages parse', parses);
  yes('U2 the board panel has Your jobs, with Put it back only on this board\'s rows',
      page.indexOf("out += '<h3>Your jobs</h3>';") !== -1 &&
      /if \(mine\.hold === b\.hold\) \{\s*out \+= '<button data-do="drop" data-n="'/.test(page) &&
      page.indexOf("if (verb === 'drop' && n) { net('/dropjob ' + n); return; }") !== -1);
  yes('U3 and the line that counts the older ones', /var older = Number\(b\.older\) \|\| 0;/.test(page) &&
      /older ones are/.test(page));
  yes('U4 the panel still posts, takes and takes down with its buttons',
      page.indexOf("line = '/notice ' + slashTitle(title)") !== -1 &&
      page.indexOf("line = '/job ' + Number(reward) + ' ' + slashTitle(title)") !== -1 && page.indexOf('net(line);') !== -1 &&
      page.indexOf("net('/take ") !== -1 && page.indexOf("net('/unpin ") !== -1);
  yes('U5 J lists the towns under Boards and picking one sends /board and the town',
      /'<h3>Boards<\/h3>'/.test(journal) && /data-board="/.test(journal) &&
      journal.indexOf("net('/board ' + this.getAttribute('data-board'));") !== -1);
  const drawBoards = slice(journal, '  function drawBoards(main) {', '\n  }\n');
  yes('U6 J\'s board is read only: drawing it sends nothing and has no button',
      !!drawBoards && drawBoards.indexOf('net(') === -1 && drawBoards.indexOf('<button') === -1 &&
      drawBoards.indexOf('Your jobs') !== -1 && drawBoards.indexOf('read.wall') !== -1);
  yes('U7 the town that is lit is the server\'s answer', /var reading = \(bv\.read && bv\.read\.hold\) \|\| '';/.test(journal) &&
      /if \(boardsShown\(\)\) \{ drawBoards\(main\); return; \}/.test(journal));
  yes('U8 the social view carries J\'s boards, from the property block, for this character',
      /boards: \(function \(\) \{\s*try \{\s*var prop = g\.__thornswoodProperty;\s*if \(!prop \|\| !prop\.boardsView\) \{ return null; \}\s*return prop\.boardsView\(mine\);/.test(social) &&
      /boardsView: boardsView,/.test(prop) &&
      social.indexOf('window.thornswoodJournal.setData(d)') !== -1);
});

done();
