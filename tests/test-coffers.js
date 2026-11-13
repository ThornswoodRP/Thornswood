// test-coffers.js
//
// The hold's fees, rent and the notice boards.
//
// Patrick's design, 21 September: twenty gold for a notice which is read only,
// thirty for a job which goes on the taker's list, and the fee is the hold's.
// Rent is handed to a steward in person or put in the hold's drop box; the
// server counts and does not seize, even though it owns everybody's pack and
// could.
//
// THE MARKED CHEST IS RETIRED (#2298, Patrick, 15 Oct, decision 3 A). This
// file used to drive putIn, the answer to mp.onPutItem for a container a
// steward had marked as a hold's box: only gold went in, and it was counted
// onto the hold's ledger. The drop box on the board is the only box now, and
// tests/test-2298-dropbox.js drives it, rent first included. What is left
// here checks the put hook answers for no container, and drives posting and
// taking at a board.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
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
  Out of the property block only, cut first the way test-1374-letters.js does:
  gamemode.js has more than one post and take since the book and ledger
  blocks came in, and the first one in the file is not always the board's.
*/
const P0 = src.indexOf('// ==== thornswood property ====');
const P1 = P0 < 0 ? -1 : src.indexOf('// ==== end thornswood property ====', P0);
const prop = (P0 < 0 || P1 < 0) ? '' : src.slice(P0, P1);
yes('the property block is in the gamemode, between its markers', prop.length > 0);
function lift(from, to) {
  const a = prop.indexOf(from);
  if (a < 0 || prop.indexOf(from, a + 1) >= 0) { return null; }
  const b = prop.indexOf(to, a);
  return b < 0 ? null : prop.slice(a, b + to.length);
}

const postBlock = lift('  function post(parts, actorId, profileId, toProfile, isJob) {', '\n  }\n');
// The line a post arrives on, a title and a body (#2554).
const wordsBlock = lift('  function postWords(line) {', '\n  }\n');

yes('the marked chest\'s answer is gone from the property block (#2298)',
    prop.indexOf('function putIn(') === -1);
yes('and posting to a board is in it', postBlock !== null && wordsBlock !== null);

const ALICE = 101;

if (postBlock !== null && wordsBlock !== null) {
  /*
    Drive post with a pack, at Whiterun's board. Since #4901 a post takes its
    gold out of the pack through packFirst, the way the merchant and quest
    moves do, and lands on the board once the pack is saved: the real pieces
    come from tests/fixtures/pack-first.js, over a pretend engine whose save
    keeps up with every write. took is the gold that left the pack, and broke
    is a pack with no gold in it.
  */
  const PACK_FIRST = require('./fixtures/pack-first');
  const GOLD = 0x0000000F;
  const PURSE = 1000;
  function posting(opts) {
    const told = [];
    const drawn = [];
    const notices = opts.notices || {};
    const funds = { whiterun: 0 };
    const store = { inventory: { entries: opts.broke ? [] : [{ baseId: GOLD, count: PURSE }] } };
    const mp = PACK_FIRST.receipts({
      get: function (id, key) {
        if (key === 'inventory') { return store.inventory; }
        if (key === 'profileId') { return ALICE; }
        return { name: 'Alice' };
      },
      set: function (id, key, value) { if (key === 'inventory') { store.inventory = value; } }
    });
    const fn = new Function(
      'notices', 'funds', 'save', 'plog', 'mp',
      'NOTICE_FEE', 'JOB_FEE', 'POST_TITLE_CHARS', 'POST_BODY_CHARS', 'boardHere', 'refreshPanel', 'GOLD_ID',
      wordsBlock + '\n' + postBlock + '\n' + PACK_FIRST.pieces(prop) + '\nreturn post;');
    const call = fn(
      notices, funds,
      function () { }, function () { },
      mp,
      20, 30, 60, 600,
      // Standing at Whiterun's board unless the test says otherwise. The
      // board is what makes /notice a board rather than a command.
      function () { return opts.noBoard ? null : 'whiterun'; },
      // Every board word ends by drawing the panel again (#1374);
      // test-unpin.js drives the real one.
      function (actorId) { drawn.push(actorId); },
      GOLD);
    call(opts.parts, 0xff000058, ALICE,
         function (pid, m) { told.push(m); }, !!opts.isJob);
    const left = (store.inventory.entries || []).filter(function (e) { return e.baseId === GOLD; })
      .reduce(function (s, e) { return s + (Number(e.count) || 0); }, 0);
    const took = (opts.broke ? 0 : PURSE) - left;
    return { told: told, notices: notices, funds: funds, took: took, drawn: drawn };
  }

  // S6: a notice costs twenty and lands on the board.
  {
    const r = posting({ parts: ['/notice', 'Room', 'to', 'let', '::', 'Above', 'the', 'smithy.'] });
    yes('S6 a notice costs twenty gold', r.took === 20);
    yes('S6 and it is on the board', r.notices.whiterun.length === 1);
    yes('S6 and the poster\'s board panel is drawn again', r.drawn.length === 1 && r.drawn[0] === 0xff000058);
    yes('S6 with the title and the body that were said (#2554)',
        r.notices.whiterun[0].title === 'Room to let' && r.notices.whiterun[0].text === 'Above the smithy.');
    yes('S6 and the fee goes to the hold', r.funds.whiterun === 20);
  }

  // S7: a job costs thirty and its reward, and is marked as one, because a
  //     job goes on the taker's list and a notice is read only (#2554).
  {
    const r = posting({ parts: ['/job', '12', 'Clear', 'the', 'cellar', '::', 'Rats.'], isJob: true });
    yes('S7 a job costs thirty gold and its reward, taken together', r.took === 42);
    yes('S7 and is marked as a job, with its reward held in pay', r.notices.whiterun[0].job === true &&
        r.notices.whiterun[0].pay === 12 && r.funds.whiterun === 42);
  }

  // S8: no gold, no notice. Nothing is posted on credit.
  {
    const r = posting({ parts: ['/notice', 'Room', '::', 'to', 'let'], broke: true });
    yes('S8 somebody who cannot pay posts nothing',
        !r.notices.whiterun || r.notices.whiterun.length === 0);
    yes('S8 and is told the price', r.told[0].indexOf('20 gold') !== -1);
  }

  // S9: AWAY FROM A BOARD NOTHING IS POSTED AND NOTHING IS CHARGED. This is
  //     what makes it a board rather than a command you can say anywhere.
  {
    const r = posting({ parts: ['/notice', 'Room', '::', 'to', 'let'], noBoard: true });
    yes('S9 away from a board the fee is not taken', r.took === 0);
    yes('S9 and it says to stand at one',
        r.told[0].indexOf('notice board') !== -1);
  }

  // S10: an empty notice is not a twenty gold blank.
  {
    const r = posting({ parts: ['/notice'] });
    yes('S10 an empty notice costs nothing', r.took === 0);
  }
}

// ------------------------------------------------------ the taker's list
//
// Patrick: thirty gold for a job, "which goes on the taker's list". A job is
// the one thing on a board with a second half. The server records who took
// what and takes it off the open board so two people do not both go and do it.
// It does not judge whether a job was done: a server that did would be
// refereeing roleplay. Since #2554 a job's reward is held from the moment it
// is posted and paid when its poster says it is done, which
// tests/test-2554-board-posts.js drives.
{
  const takeBlock = lift('  function take(parts, actorId, profileId, toProfile) {', '\n  }\n');
  yes('the taker\'s list is in the gamemode', takeBlock !== null);

  function taking(opts) {
    const told = [];
    const notices = { whiterun: opts.list };
    const fn = new Function(
      'parts', 'actorId', 'profileId', 'toProfile',
      'boardHere', 'notices', 'save', 'plog', 'mp', 'Number', 'refreshPanel',
      takeBlock + '\nreturn take;');
    const call = fn(
      null, null, null, null,
      function () { return opts.noBoard ? null : 'whiterun'; },
      notices, function () { }, function () { },
      { get: function () { return { name: opts.who || 'Bob' }; } },
      Number, function () { });
    call(opts.parts, 0xff000058, opts.by,
         function (pid, m) { told.push(m); });
    return { told: told, list: notices.whiterun };
  }

  if (takeBlock !== null) {
    const job = () => ({ by: ALICE, name: 'Alice', title: 'Clear the cellar', text: 'Rats.',
                         at: 1, job: true, pay: 12, taken: 0 });
    const notice = () => ({ by: ALICE, name: 'Alice', title: 'Room to let', text: 'Above the smithy.',
                            at: 1, job: false, taken: 0 });

    // S11: taking a job puts your name on it.
    {
      const r = taking({ by: 202, parts: ['/take', '1'], list: [job()] });
      yes('S11 a job can be taken', r.list[0].taken === 202);
      yes('S11 and the taker is named on it', r.list[0].takenName === 'Bob');
      yes('S11 and is sent to the person who posted it',
          r.told[0].indexOf('Alice') !== -1);
      yes('S11 and told the reward is held until they say it is done',
          r.told[0].indexOf('The 12 gold reward is held until Alice says it is done.') !== -1);
    }

    // S12: and only one person gets it.
    {
      const held = job(); held.taken = 303; held.takenName = 'Cyrus';
      const r = taking({ by: 202, parts: ['/take', '1'], list: [held] });
      yes('S12 a job somebody already has cannot be taken again',
          r.list[0].taken === 303);
      yes('S12 and says who has it', r.told[0].indexOf('Cyrus') !== -1);
    }

    // S13: a notice is not a job.
    {
      const r = taking({ by: 202, parts: ['/take', '1'], list: [notice()] });
      yes('S13 a notice cannot be taken', r.list[0].taken === 0);
      yes('S13 and says so', r.told[0].indexOf('not a job') !== -1);
    }

    // S14: and you cannot take your own.
    {
      const r = taking({ by: ALICE, parts: ['/take', '1'], list: [job()] });
      yes('S14 your own job is not takeable', r.list[0].taken === 0);
    }

    // S15: away from the board, nothing.
    {
      const r = taking({ by: 202, parts: ['/take', '1'], list: [job()],
                         noBoard: true });
      yes('S15 a job cannot be taken from across Skyrim', r.list[0].taken === 0);
    }
  }
}

// ---------------------------------------------------------------- structure
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('the put hook is registered with the engine, under guard() for the join pass',
      /mp\.onPutItem = guard\('onPutItem'/.test(code));
  const put = src.match(/^mp\.onPutItem = guard\('onPutItem',[\s\S]*?^\}\);/m);
  const context = { mp: {}, guard: (name, fn) => fn,
    globalThis: { __thornswoodProperty: new Proxy({}, { get() { throw Error('container property consulted'); } }) } };
  require('node:vm').createContext(context);
  require('node:vm').runInContext(require('./fixtures/ordinary-quest-items') + put[0], context);
  yes('ordinary goods pass every container without consulting its property rules (#2298)',
      context.mp.onPutItem(111, 222, 15, 3) === undefined &&
      context.mp.onPutItem(333, 222, 12, 1) === undefined);
  const putHook = (code.match(/mp\.onPutItem = guard\('onPutItem', function \([^)]*\) \{[\s\S]*?\n\}\);/) || [''])[0];
  yes('and it asks the property block nothing: no container has a rule of its own (#2298); only the cuffs on a prisoner refuse a put (#2573)',
      putHook !== '' && !/prop\.putIn|__thornswoodProperty|putIn\(/.test(putHook) &&
      /__thornswoodCuffs/.test(putHook) && /mayLetGo\(/.test(putHook));
  yes('the board words are in the one list, and /box is not',
      /'\/evict', '\/rent',/.test(code) && /'\/notice', '\/job', '\/board',/.test(code) && !/'\/box'/.test(code));
  yes('and the dispatcher routes them, and never /box',
      /word === '\/board'\)/.test(code) && !/word === '\/box'/.test(code));
  yes('a container somebody opens is not remembered as a box',
      !/touchedBox/.test(code));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
