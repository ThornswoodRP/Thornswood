// test-unpin.js
//
// Entry 331, notice boards in every hold. Two things, both proved here.
//
// A POSTER CAN TAKE DOWN THEIR OWN NOTICE, AND NOBODY ELSE'S. Before /unpin,
// nothing took a notice down at all: board() said so in a comment, and a
// notice paid for was up for ever. /unpin <n> takes down the poster's own
// notice or their own untaken job. A job somebody has taken stays up until
// they hand it back, the fee is not refunded, and the numbers /take and
// /dropjob act on do not move when one comes down.
//
// THE DEAD INSTALLER IS GONE. tools/Add-NoticeBoards.ps1 put Missives into the
// build and published a release saying the boards worked. Missives came out
// on 15 September and the boards are the server's own now, so the script can
// only ever put back the thing that was removed.
//
// And the entry's done-when, with nobody in the world: "pin a notice to a
// board reference through the gamemode path, restart the server, read it
// back, and confirm the coin was taken and the notice survived." The restart
// here is what the server really does when it starts: a second boot of the
// real functions, with no memory carried over, reading the register off disk
// through loadPart. The pack is the engine's, which keeps it across a
// restart, so the same pretend pack is used on both sides.
//
// Writes only to a scratch folder under the system temp directory, and
// removes it.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const os = require('os');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/*
  One function out of the property block, by its whole first line, and only
  if that line is there exactly once in the block. There are three functions
  called command and two called post in gamemode.js, and since the book and
  ledger blocks came in (#1417 and later) three called save, so the block is
  cut out first, the way test-1374-letters.js does, and the lift is inside it.
  Lifting the wrong one would test nothing.
*/
const P0 = src.indexOf('// ==== thornswood property ====');
const P1 = P0 < 0 ? -1 : src.indexOf('// ==== end thornswood property ====', P0);
const prop = (P0 < 0 || P1 < 0) ? null : src.slice(P0, P1);
yes('the property block is in the gamemode, between its markers', prop !== null);
function lift(first) {
  if (prop === null) { return null; }
  const from = '\n  ' + first;
  const a = prop.indexOf(from);
  if (a < 0 || prop.indexOf(from, a + 1) >= 0) { return null; }
  const b = prop.indexOf('\n  }\n', a + 1);
  return b < 0 ? null : prop.slice(a + 1, b + 4);
}

function number(re) {
  const m = src.match(re);
  return m ? Number(m[1]) : NaN;
}

// ------------------------------------------------------ the dead installer
yes('Add-NoticeBoards.ps1 is gone from scripts\\mods',
    !fs.existsSync(path.join(REPO_DIR, 'scripts', 'mods', 'Add-NoticeBoards.ps1')));

// ------------------------------------------------------------ the pieces
const PIECES = {
  // The one read and write path of the block's files (#4529).
  storeRead: 'function storeRead(file, what) {',
  storeWrite: 'function storeWrite(file, text, read) {',
  loadPart: 'function loadPart(key, fallback) {',
  save: 'function save() {',
  takeGold: 'function takeGold(actorId, amount) {',
  // A job's reward comes back to its poster on a take down (#2554).
  payOut: 'function payOut(actorId, amount) {',
  payHeld: 'function payHeld(hold, n, actorId) {',
  // The line a post arrives on: a title and a body (#2554).
  postWords: 'function postWords(line) {',
  post: 'function post(parts, actorId, profileId, toProfile, isJob) {',
  board: 'function board(parts, actorId, profileId, toProfile) {',
  // What the wall shows, on the board's panel and on J (#1627).
  wallOf: 'function wallOf(hold, profileId) {',
  take: 'function take(parts, actorId, profileId, toProfile) {',
  dropJob: 'function dropJob(parts, actorId, profileId, toProfile) {',
  takedown: 'function takedown(hold, at, byWhom) {',
  unpin: 'function unpin(parts, actorId, profileId, toProfile) {',
  // Every board word ends by asking the social block to draw the panel
  // again (#1374). The real one, against a social block that keeps a list.
  refreshPanel: 'function refreshPanel(actorId) {'
};
const lifted = {};
const missing = [];
for (const k in PIECES) {
  lifted[k] = lift(PIECES[k]);
  if (lifted[k] === null) { missing.push(k); }
}
yes('every piece of the board is in the gamemode, once' +
    (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''),
    missing.length === 0);

const GOLD = number(/var GOLD_ID = (0x[0-9A-Fa-f]+);/);
const NOTICE_FEE = number(/var NOTICE_FEE = (\d+);/);
const JOB_FEE = number(/var JOB_FEE = (\d+);/);
const TITLE_CHARS = number(/var POST_TITLE_CHARS = (\d+);/);
const BODY_CHARS = number(/var POST_BODY_CHARS = (\d+);/);
yes('the gold id, both fees and a post\'s two lengths are read out of the file',
    GOLD === 15 && NOTICE_FEE > 0 && JOB_FEE > 0 && TITLE_CHARS === 60 && BODY_CHARS === 600);

const ALICE = { actor: 0xff000058, pid: 101, name: 'Alice' };
const BOB = { actor: 0xff000059, pid: 202, name: 'Bob' };
const CYRUS = { actor: 0xff00005a, pid: 303, name: 'Cyrus' };

/*
  The engine: packs and names, kept across a restart, because SkyMP keeps
  actors itself and the register is the only thing this block writes.
*/
function engine(startGold) {
  const packs = {};
  const names = {};
  [ALICE, BOB, CYRUS].forEach(function (p) {
    packs[p.actor] = [{ baseId: GOLD, count: startGold }];
    names[p.actor] = p.name;
  });
  let at = 'whiterun';
  return {
    mp: {
      get: function (actor, key) {
        if (key === 'inventory') {
          return { entries: (packs[actor] || []).map(function (e) { return Object.assign({}, e); }) };
        }
        if (key === 'appearance') { return { name: names[actor] }; }
        return null;
      },
      set: function (actor, key, v) {
        if (key === 'inventory') { packs[actor] = v.entries; }
      }
    },
    boardHere: function () { return at; },
    standAt: function (hold) { at = hold; },
    gold: function (p) {
      return (packs[p.actor] || []).reduce(function (s, e) {
        return s + (e.baseId === GOLD ? e.count : 0);
      }, 0);
    }
  };
}

/* One boot of the server's board, over a register in `dir`. */
function boot(dir, eng) {
  const body = [
    // The register as the block reads it once at its start (#4529).
    'var registerRead = storeRead(registerPath(), \'property register\');',
    'var claims = {};',
    // The master key counter save() writes beside the claims (#2254).
    'var masterCut = 0;',
    // The holders' word save() writes beside them (#2680).
    'var wordBook = { list: [] };',
    // Rent still owed by somebody who no longer holds the place (#3893), written with them.
    'var arrears = {};',
    // Nobody guards this board, keeps it or is its Jarl; a guard's take down
    // (#502) is game/tests/test-502-guard-board.js, the offices (#2551)
    // tests/test-2551-hold-offices.js.
    'function isGuard() { return false; }',
    'function isJarlOf() { return false; }',
    'function isStewardOf() { return false; }',
    'var boxes = loadPart(\'boxes\', {});',
    'var dropbox = loadPart(\'dropbox\', {});',
    'var funds = loadPart(\'funds\', {});',
    'var notices = loadPart(\'notices\', {});',
    'var boards = loadPart(\'boards\', { whiterun: { where: \'Whiterun\' }, riften: { where: \'Riften\' } });',
    'var GOLD_ID = ' + GOLD + ';',
    'var NOTICE_FEE = ' + NOTICE_FEE + ';',
    'var JOB_FEE = ' + JOB_FEE + ';',
    'var POST_TITLE_CHARS = ' + TITLE_CHARS + ';',
    'var POST_BODY_CHARS = ' + BODY_CHARS + ';',
    'var boardReads = {};',
    // The register's one-shot marks (#502), which save() writes with the rest.
    'var steps = loadPart(\'steps\', {});',
    'var g = { __thornswoodSocial: { push: function (actorId, now) { pushed.push(actorId); } } };'
  ];
  for (const k in lifted) { body.push(lifted[k]); }
  body.push('return { post: post, board: board, take: take, dropJob: dropJob, wallOf: wallOf, ' +
            'unpin: unpin, takedown: takedown, save: save, ' +
            'notices: function () { return notices; }, ' +
            'funds: function () { return funds; } };');
  const pushed = [];
  const fn = new Function('require', 'registerPath', 'mp', 'plog', 'boardHere', 'pushed',
                          body.join('\n'));
  const api = fn(require, function () { return path.join(dir, 'property.json'); },
                 eng.mp, function () { }, eng.boardHere, pushed);
  api.pushed = pushed;

  /* Say something at the board as somebody, and hear what they are told. */
  function say(p, word, rest) {
    const told = [];
    const parts = [word].concat(rest ? String(rest).split(' ') : []);
    const to = function (pid, m) { told.push(m); };
    if (word === '/notice') { api.post(parts, p.actor, p.pid, to, false); }
    else if (word === '/job') { api.post(parts, p.actor, p.pid, to, true); }
    else if (word === '/board') { api.board(parts, p.actor, p.pid, to); }
    else if (word === '/take') { api.take(parts, p.actor, p.pid, to); }
    else if (word === '/dropjob') { api.dropJob(parts, p.actor, p.pid, to); }
    else if (word === '/unpin') { api.unpin(parts, p.actor, p.pid, to); }
    return told.join('\n');
  }
  api.say = say;
  return api;
}

/* The wall as the server hands it to the panel and J: the rows, and the older count. */
function wall(s, p) { return s.wallOf('whiterun', p.pid); }
function row(w, n) {
  for (let i = 0; i < w.rows.length; i++) { if (w.rows[i].n === n) { return w.rows[i]; } }
  return null;
}
function shows(w, text) { return w.rows.some(function (r) { return r.text === text || r.title === text; }); }

let dir = null;
if (missing.length === 0) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-unpin-'));
}

try {
  if (dir !== null) {
    const eng = engine(200);

    // U1: THE DONE-WHEN. Pin a notice, restart, read it back.
    {
      const s1 = boot(dir, eng);
      const said = s1.say(ALICE, '/notice', 'Room to let at the Bannered Mare :: Ask Hulda.');
      yes('U1 a notice goes up and says what it cost',
          said.indexOf(NOTICE_FEE + ' gold') !== -1);
      yes('U1 the coin was taken from the pack', eng.gold(ALICE) === 200 - NOTICE_FEE);
      yes('U1 and the fee went to the hold', s1.funds().whiterun === NOTICE_FEE);
      yes('U1 and the poster\'s board panel is drawn again', s1.pushed.indexOf(ALICE.actor) !== -1);

      const s2 = boot(dir, eng);
      const read = wall(s2, BOB);
      yes('U1 after a restart the notice is still on the board',
          !!row(read, 1) && row(read, 1).name === 'Alice' && !row(read, 1).job &&
          row(read, 1).title === 'Room to let at the Bannered Mare' && row(read, 1).text === 'Ask Hulda.');
      yes('U1 and the hold still has the fee', s2.funds().whiterun === NOTICE_FEE);
      yes('U1 and the coin stayed taken', eng.gold(ALICE) === 200 - NOTICE_FEE);
    }

    // A job of Alice's at [2] and a job of Bob's at [3].
    let s = boot(dir, eng);
    s.say(ALICE, '/job', '10 Clear the cellar :: Rats.');
    s.say(BOB, '/job', '10 Fetch firewood :: Ten logs, split.');
    const aliceGold = eng.gold(ALICE);
    const funds = s.funds().whiterun;

    // U2: NOBODY ELSE'S.
    {
      const said = s.say(BOB, '/unpin', '1');
      yes('U2 somebody else\'s notice cannot be taken down',
          !s.notices().whiterun[0].down);
      yes('U2 and they are told it is not theirs', said.indexOf('not yours') !== -1);
    }

    // U3: A JOB SOMEBODY HAS TAKEN STAYS UP, even for the person who posted it.
    {
      s.say(BOB, '/take', '2');
      const said = s.say(ALICE, '/unpin', '2');
      yes('U3 a job somebody has taken stays up', !s.notices().whiterun[1].down);
      yes('U3 and the poster is told who has it', said.indexOf('Bob') !== -1);
      yes('U3 and the taker still has it on their list',
          s.notices().whiterun[1].taken === BOB.pid);
    }

    // U4: once it is handed back, its poster can take it down.
    {
      s.say(BOB, '/dropjob', '2');
      const said = s.say(ALICE, '/unpin', '2');
      yes('U4 a job handed back can be taken down by its poster',
          !!s.notices().whiterun[1].down);
      yes('U4 and it says the fee stays with the hold',
          said.indexOf('fee stays') !== -1);
      // The fee is never refunded; the reward was only held, and comes back (#2554).
      yes('U4 with no refund of the fee, and the 10 reward back in the pack',
          eng.gold(ALICE) === aliceGold + 10 && said.indexOf('The 10 gold reward comes back to you.') !== -1);
      yes('U4 and only the reward out of the hold', s.funds().whiterun === funds - 10);
    }

    // U5: THE NUMBERS DO NOT MOVE. [3] still means Bob's job.
    {
      const read = wall(s, CYRUS);
      yes('U5 the board no longer shows what came down',
          !shows(read, 'Clear the cellar') && !row(read, 2));
      yes('U5 and the others keep the numbers they had',
          !!row(read, 3) && row(read, 3).job && !row(read, 3).taken && row(read, 3).name === 'Bob' &&
          row(read, 3).title === 'Fetch firewood' && row(read, 3).reward === 10 &&
          !!row(read, 1) && row(read, 1).name === 'Alice' && /^Room to let/.test(row(read, 1).title));
      const gap = s.say(CYRUS, '/take', '2');
      yes('U5 the number that came down cannot be taken',
          gap.indexOf('taken down') !== -1 && !s.notices().whiterun[1].taken);
      s.say(CYRUS, '/take', '3');
      yes('U5 and /take 3 still takes the job that was [3]',
          s.notices().whiterun[2].taken === CYRUS.pid);
    }

    // U6: and all of that survives a restart.
    {
      s = boot(dir, eng);
      const read = wall(s, BOB);
      yes('U6 after a restart what came down is still down',
          !shows(read, 'Clear the cellar') && !!s.notices().whiterun[1].down);
      yes('U6 and the list kept its gap rather than closing it',
          s.notices().whiterun.length === 3 && !!row(read, 3) && row(read, 3).name === 'Bob' &&
          row(read, 3).taken === 'Cyrus' && row(read, 3).mine === true);
      yes('U6 and the register says who took it down',
          s.notices().whiterun[1].downBy === ALICE.pid);
    }

    // U7: the refusals that change nothing.
    {
      const twice = s.say(ALICE, '/unpin', '2');
      yes('U7 something already down says so', twice.indexOf('already down') !== -1);
      const none = s.say(ALICE, '/unpin', '9');
      const word = s.say(ALICE, '/unpin', 'cellar');
      yes('U7 a number that is not on the board is refused, and so is a word, naming no command',
          none.indexOf('not on the board') !== -1 && word.indexOf('not on the board') !== -1 &&
          none.indexOf('/') === -1);
      eng.standAt(null);
      const away = s.say(ALICE, '/unpin', '1');
      yes('U7 away from a board nothing comes down',
          away.indexOf('Stand at the board') !== -1 && !s.notices().whiterun[0].down);
      eng.standAt('riften');
      s.say(ALICE, '/unpin', '1');
      yes('U7 and at another hold\'s board, Whiterun\'s notices are out of reach',
          !s.notices().whiterun[0].down);
      eng.standAt('whiterun');
    }

    // U8: the last ones come down and the board says it is empty.
    {
      s.say(ALICE, '/unpin', '1');
      s.say(CYRUS, '/dropjob', '3');
      s.say(BOB, '/unpin', '3');
      const read = wall(s, ALICE);
      yes('U8 a board with everything taken down has nothing on it', read.rows.length === 0 && read.older === 0);
    }

    /*
      U9: THE OLDER COUNT COUNTS WHAT IS STILL UP. Twelve notices, the newest
      taken down: ten shown, one older, not two.
    */
    {
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-unpin-'));
      try {
        const e2 = engine(1000);
        const b = boot(dir2, e2);
        for (let i = 1; i <= 12; i++) { b.say(ALICE, '/notice', 'Notice ' + i + ' :: Number ' + i + '.'); }
        b.say(ALICE, '/unpin', '12');
        const read = wall(b, BOB);
        yes('U9 the newest one taken down is not shown', !row(read, 12));
        yes('U9 the ten shown are the ten newest still up',
            read.rows.length === 10 && !!row(read, 11) && !!row(read, 2) && !row(read, 1) &&
            read.rows[0].n === 11);
        yes('U9 and it says one older, not two', read.older === 1);
      } finally {
        fs.rmSync(dir2, { recursive: true, force: true });
      }
    }

    /*
      U10: THE STORE HALF, FOR THE GUARDS. takedown has no rule about who may,
      because that is the guards' own (entries 209 and 208).
    */
    {
      const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-unpin-'));
      try {
        const e3 = engine(200);
        const b = boot(dir3, e3);
        b.say(BOB, '/notice', 'Wanted: the man who stole my goat :: Reward offered.');
        const first = b.takedown('whiterun', 0, 999);
        yes('U10 takedown takes anybody\'s notice down and records by whom',
            !!first && first.down > 0 && first.downBy === 999);
        yes('U10 and a second takedown of the same one does nothing',
            b.takedown('whiterun', 0, 999) === null);
        yes('U10 and one that does not exist does nothing',
            b.takedown('whiterun', 5, 999) === null && b.takedown('nowhere', 0, 999) === null);
        yes('U10 and it is saved', !!boot(dir3, e3).notices().whiterun[0].down);
      } finally {
        fs.rmSync(dir3, { recursive: true, force: true });
      }
    }
  }
} catch (e) {
  yes('the board ran without throwing (' + String((e && e.message) || e) + ')', false);
} finally {
  if (dir !== null) { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ------------------------------------------------------------- the wiring
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('the property block routes /unpin',
      /if \(word === '\/unpin'\) \{ return unpin\(parts, actorId, profileId, toProfile\); \}/.test(code));
  yes('the chat hands /unpin to the property block with the other board words',
      /word === '\/dropjob' \|\| word === '\/unpin'\) \{/.test(code));
  yes('takedown is on g.__thornswoodProperty for the guards',
      /takedown: takedown/.test(code));

  function list(name) {
    const a = src.indexOf('const ' + name + ' = [');
    const b = a < 0 ? -1 : src.indexOf('];', a);
    if (b < 0) { return []; }
    try {
      return new Function('return ' + src.slice(a + ('const ' + name + ' = ').length, b + 1))();
    } catch (e) { return []; }
  }
  yes('/unpin is in the list of words the server answers',
      list('WORDS').indexOf('/unpin') !== -1);
  yes('and in no list anybody is told about: Take down on the board panel sends it (#1627)',
      list('PLAYER_WORDS').indexOf('/unpin') === -1);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
