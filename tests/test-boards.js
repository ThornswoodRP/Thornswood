// test-boards.js
//
// The nine notice board sites, and the one thing that makes changing them
// hard: boards are SAVED.
//
// Djinn, 22 September, in "Borad location coords": nine towns with a facing
// each, and "Suggest allocation then verification and orientation" under them.
// The boards were seeded at each hold's inn before that, out of the chargen
// arrival table, because those were the only positions this server had ever
// stood anybody on.
//
// WHAT THIS EXISTS TO CATCH. `boards` lives in the register beside the claims
// and the notices, and that file is written every time anything in it is. So
// on any server that has been played on, loadPart('boards') answers and the
// seeding is never reached again: a new table of coordinates would move the
// boards on a fresh server and on no other. The fix would read perfectly and
// nothing in the world would change, which is the same shape as the seam that
// could not be written and the harness that passed all evening.
//
// So most of what is below is about the SAVED case, not the fresh one.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const a = src.indexOf('var BOARD_REACH = 400;');
const b = a < 0 ? -1 : src.indexOf('/** The hold whose board somebody is standing at', a);
let block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;

/* The real functions, over a pretend chargen table and a pretend register. */
function rig(saved) {
  const logs = [];
  const PASSAGES = {
    'e80030:X.esp': { key: 'whiterun', town: 'Whiterun',
      arrival: { desc: '1605e:Skyrim.esm', pos: [-113.6, -810, 69.3] } },
    'e80031:X.esp': { key: 'riften', town: 'Riften',
      arrival: { desc: '16bdf:Skyrim.esm', pos: [-150.2, -598.2, 64] } },
    'e80032:X.esp': { key: 'solitude', town: 'Solitude',
      arrival: { desc: '16a0e:Skyrim.esm', pos: [-178, -1504, 128] } },
    'e80033:X.esp': { key: 'windhelm', town: 'Windhelm',
      arrival: { desc: '16789:Skyrim.esm', pos: [554.3, -3766.2, 64] } },
    'e80034:X.esp': { key: 'markarth', town: 'Markarth',
      arrival: { desc: '16dfe:Skyrim.esm', pos: [-5588.5, -1925.8, -16] } },
    'e80035:X.esp': { key: 'falkreath', town: 'Falkreath',
      arrival: { desc: '3a184:Skyrim.esm', pos: [673.1, -620.3, 0] } },
    'e80036:X.esp': { key: 'morthal', town: 'Morthal',
      arrival: { desc: '138ce:Skyrim.esm', pos: [1970.6, -160.2, 0] } },
    'e80037:X.esp': { key: 'dawnstar', town: 'Dawnstar',
      arrival: { desc: '13a7f:Skyrim.esm', pos: [1824.3, -683.7, 0] } },
    'e80038:X.esp': { key: 'winterhold', town: 'Winterhold',
      arrival: { desc: '13814:Skyrim.esm', pos: [1791.6, 7.3, 0] } },
    // A town with no site of its own, so the inn fallback is exercised.
    'e80039:X.esp': { key: 'ravenrock', town: 'Raven Rock',
      arrival: { desc: '1a26f:Dragonborn.esm', pos: [10, 20, 30] } }
  };
  const fn = new Function(
    'PASSAGES', 'plog', 'loadPart', 'Object', 'Date',
    block + '\nreturn { boards: boards, seed: BOARD_SEED, sites: BOARD_SITES, ' +
            'cell: \'3c:Skyrim.esm\', reach: BOARD_REACH, seedBoards: seedBoards };');
  const api = fn(
    PASSAGES,
    function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    function () { return saved; },
    Object, Date);
  api.logs = logs;
  return api;
}

/*
  A BLOCK THAT WILL NOT RUN IS A FAILURE, NOT A CRASH.

  Run against a gamemode from before the sites went in, this threw
  "BOARD_SEED is not defined" out of the first rig and took the whole harness
  with it: one PASS, a stack trace, and no count. A harness that dies cannot
  say what is wrong, and this one is read by whoever is wondering why the
  boards did not move. So the block is tried once here, and everything below
  is skipped with a plain failure if it will not stand up.
*/
let why = '';
if (block !== null) {
  try { rig(null); } catch (e) { why = String((e && e.message) || e); block = null; }
}
yes('the board seeding is in the gamemode and runs' + (why ? ' (' + why + ')' : ''),
    block !== null);

if (block !== null) {
  const TOWNS = ['solitude', 'whiterun', 'riften', 'windhelm', 'markarth',
                 'falkreath', 'morthal', 'dawnstar', 'winterhold'];

  // S1: a server that has never written its register takes the whole table.
  {
    const r = rig(null);
    yes('S1 a fresh server gets a board in all nine holds',
        TOWNS.every(function (t) { return !!r.boards[t]; }));
    // #2516, measured 15 Oct: the five walled cities are their own worldspaces.
    const WORLDS = { solitude: '37edf:Skyrim.esm', whiterun: '1a26f:Skyrim.esm', riften: '16bb4:Skyrim.esm',
                     windhelm: '1691d:Skyrim.esm', markarth: '16d71:Skyrim.esm' };
    yes('S1 every one of the nine is outdoors, not in an inn: the four open towns in Tamriel, ' +
        'the five walled cities in their own worldspaces',
        TOWNS.every(function (t) { return r.boards[t].cell === (WORLDS[t] || r.cell); }));
    // #2516: no single BOARD_CELL; each site names its own cell or worldspace.
    yes('S1 and each site carries its own worldspace, rather than one for all',
        TOWNS.every(function (t) { return r.sites[t] && r.sites[t].cell === r.boards[t].cell; }));
    yes('S1 and a town with no site of its own still gets its inn',
        !!r.boards.ravenrock && r.boards.ravenrock.cell === '1a26f:Dragonborn.esm');
    yes('S1 Djinn\'s Whiterun coordinate is the one that went in',
        r.boards.whiterun.pos[0] === 23139.4 &&
        r.boards.whiterun.pos[1] === -7891.7 &&
        r.boards.whiterun.pos[2] === -3494.4);
    yes('S1 the facing is carried even though nothing reads it yet',
        r.boards.dawnstar.facing === 110 && r.boards.winterhold.facing === 241.4);
    yes('S1 a seeded board says which seeding it came from',
        TOWNS.every(function (t) { return r.boards[t].seed === r.seed; }));
  }

  /*
    S2 IS THE WHOLE POINT OF THIS FILE.

    A server that has been played on has the OLD inn boards saved, written
    before the seed field existed. Those must be replaced, or the coordinates
    go out and not one board moves.
  */
  {
    const old = {};
    TOWNS.forEach(function (t) {
      old[t] = { cell: '1605e:Skyrim.esm', pos: [-113.6, -810, 69.3], where: t };
    });
    const r = rig(old);
    yes('S2 boards saved by the OLD inn seeding are replaced, not kept',
        TOWNS.every(function (t) { return r.boards[t].cell === r.sites[t].cell; }));
    yes('S2 and it says in the log how many it moved',
        r.logs.some(function (l) { return l.indexOf('boards: seeding') === 0; }));
  }

  // S3: a board a steward walked to and placed is never touched by a deploy.
  {
    const saved = {
      whiterun: { cell: 'ffff:Mine.esp', pos: [1, 2, 3], where: 'Whiterun',
                  placed: 1790000000000 },
      riften: { cell: '1605e:Skyrim.esm', pos: [-113.6, -810, 69.3], where: 'riften' }
    };
    const r = rig(saved);
    yes('S3 a board a steward placed stays exactly where they put it',
        r.boards.whiterun.cell === 'ffff:Mine.esp' &&
        r.boards.whiterun.pos[0] === 1);
    yes('S3 while an untouched one beside it is re-seeded',
        r.boards.riften.cell === r.sites.riften.cell && r.boards.riften.pos[0] === 174559.5);
    yes('S3 and the seven the save never mentioned are seeded too',
        TOWNS.filter(function (t) { return t !== 'whiterun'; })
             .every(function (t) { return r.boards[t].cell === r.sites[t].cell; }));
  }

  // S4: a board already on the current seeding is left alone, so a restart
  // that changes nothing writes nothing.
  {
    const r1 = rig(null);
    const r2 = rig(JSON.parse(JSON.stringify(r1.boards)));
    yes('S4 a second load of the same seeding changes nothing',
        JSON.stringify(r2.boards) === JSON.stringify(r1.boards));
    yes('S4 and says nothing about seeding, because it seeded nothing',
        !r2.logs.some(function (l) { return l.indexOf('boards: seeding') === 0; }));
  }

  /*
    S5: THE SITES AGAINST THE GAME'S OWN TABLE OF WHERE THE TOWNS ARE.

    DATA.capitals is in gamemode.js and is not Djinn's. Every site should sit a
    short walk from its capital, which is what you get between a map marker and
    a spot by a gate.

    THIS USED TO ALLOW EXACTLY ONE EXCEPTION, Solitude, at 51,950 units. That
    was a decimal point in the wrong column and nothing else: the X read
    -6486.7 where the same person's own Solitude chopping block reads -64263,
    with the Y and Z agreeing to within 1,596 and 28. Corrected on 23 September
    and written out in full beside BOARD_SITES.

    So the exception is gone and NOTHING is allowed to be more than 10,000
    units out. That is the check worth having: it caught this one by making the
    fault a named number, and it will catch the next table edit that drops a
    digit the same way.
  */
  {
    const line = src.split('\n').find(function (l) { return l.indexOf('const DATA = ') === 0; });
    const DATA = line ? JSON.parse(line.slice('const DATA = '.length).replace(/;$/, '')) : null;
    const r = rig(null);
    const far = [];
    if (DATA && DATA.capitals) {
      for (const h in DATA.capitals) {
        const cap = DATA.capitals[h];
        const key = String(cap.town || '').toLowerCase().replace(/\s+/g, '');
        const bd = r.boards[key];
        if (!bd || !cap.pos) { continue; }
        const d = Math.hypot(bd.pos[0] - cap.pos[0], bd.pos[1] - cap.pos[1]);
        if (d > 10000) { far.push(cap.town + ' ' + Math.round(d)); }
      }
    }
    yes('S5 the capitals table was readable, or this check proves nothing',
        DATA !== null && !!DATA.capitals);
    yes('S5 no site is more than 10,000 units from its own capital' +
        (far.length ? ' (' + far.join(', ') + ')' : ''),
        far.length === 0);
  }

  // S6: the file says out loud that these are unverified, so the next person
  // does not read them as measured.
  {
    /*
      The comment is wrapped, so the quote runs across a line break and a
      straight indexOf of it finds nothing. Whitespace is flattened first. The
      first draft of this check did not, failed, and the sentence it was
      looking for was sitting right there in the file.
    */
    const flat = src.replace(/\s+/g, ' ');
    yes('S6 the provenance is written next to the table',
        flat.indexOf('Suggest allocation then verification and orientation') !== -1);
    /*
      And the correction is written down where the numbers are, because a
      coordinate somebody changed with no reason beside it is a coordinate
      nobody can check afterwards.
    */
    yes('S6 and so is why Solitude moved',
        flat.indexOf("SOLITUDE'S X WAS MISSING A DIGIT") !== -1 &&
        flat.indexOf('-64263') !== -1);
    yes('S6 and the seeding number moved with it, or nothing in the world would change',
        Number((/var BOARD_SEED = (\d+);/.exec(src) || [])[1]) >= 4);
    yes('the hold box is that town\'s notice board',
        /function holdStanding\(actorId\) \{[\s\S]*?boardHere\(actorId\)/.test(src));
    yes('S6 and a steward placing a board marks it so a deploy cannot undo it',
        /placed: Date\.now\(\)/.test(src));
  }

  {
    const front = fs.readFileSync(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'), 'utf8');
    const page = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-board.js'), 'utf8');
    const journal = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-journal.js'), 'utf8');
    yes('the board panel is what the server sends',
        /function boardPanel\(actorId, profileId\)/.test(src) &&
        src.indexOf('prop.boardPanel(actorId, mine)') !== -1 &&
        src.indexOf('window.thornswoodBoard.setData') !== -1);
    yes('clicking the board opens the panel, and only while you are there',
        front.indexOf("'thornswood-board.js'") !== -1 &&
        front.indexOf("e.userEventName !== 'Activate'") !== -1 &&
        front.indexOf('dist > BOARD_REACH') !== -1 &&
        page.indexOf('window.thornswoodBoard') !== -1);
    // #2516: the server stands the message board at the spot, and every game is sent it.
    yes('the message board object is stood at the spot by the server, not by each game',
        src.indexOf("var BOARD_BASE_DESC = '593b:Thornswood-Content.esp';") !== -1 &&
        /function standBoard\(hold, anchor\)/.test(src) &&
        front.indexOf('0x593B') === -1 && front.indexOf('ensureBoards') === -1);
    // Make a post sends a notice or a job with its title and body (#2554).
    yes('the panel is how a notice, a job, and a price list go up',
        page.indexOf("line = '/notice ' + slashTitle(title)") !== -1 &&
        page.indexOf("line = '/job ' + Number(reward) + ' ' + slashTitle(title)") !== -1 &&
        page.indexOf("net('/job done ") !== -1 &&
        page.indexOf("net('/take ") !== -1 &&
        page.indexOf("net('/unpin ") !== -1 &&
        page.indexOf("net('/dropjob ") !== -1 &&
        page.indexOf("net('/book submit ") !== -1);
    yes('the list is left at the board, not from the journal',
        journal.indexOf('Submit at the box') === -1);
    // #1597: the click and the object no longer hold a copy of the nine
    // spots, which had no cell. They learn every board from the server, cell
    // and all; tests/test-1597-board-objects.js runs that.
    const sites = rig(null).sites;
    let copied = '';
    for (const h in sites) {
      const p = sites[h].pos;
      if (front.indexOf(String(p[0])) !== -1 && front.indexOf(String(p[1])) !== -1) {
        copied += ' ' + h;
      }
    }
    yes('the click keeps no copy of the nine spots of its own' + copied, copied === '');
    yes('the server sends every board with its cell, and the game no longer needs the list to place them',
        /row\.cell = bh\.cell;/.test(src) && page.indexOf("tell('spots ' + said)") === -1 &&
        front.indexOf("what.indexOf('board:spots ') === 0") === -1);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
