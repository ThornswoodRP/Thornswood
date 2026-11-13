// test-1597-board-objects.js
//
// Every notice board the server has gets its message board object, in the
// cell or worldspace the server has it in. Issue #1597.
//
// WHY THIS EXISTS. The client put the object (ThornswoodMessageBoard, 0x593B
// in Thornswood-Content.esp) down at nine points in Tamriel written into
// game/plugins/thornswood-front.js, with no cell, the moment the page was
// ready. Raven Rock's board (#1374), seeded server side in The Retching
// Netch, had no object, nor did any board a steward walked indoors or to
// Solstheim. And placeAtMe puts the copy in the cell you are in, setPosition
// moves it within that cell: somebody who came in indoors had all nine put
// inside that room at Tamriel's numbers, and never had them outside.
//
// What changed, and what this holds: the server sends every board with its
// cell or worldspace and facing (boardsView's list, in the social view).
//
// Since #2516 the server stands the board object itself, one per hold, and
// every game is sent it: each game placing its own copies put a new one down
// at the person every two seconds for every far town (Patrick on dev, 12 Oct).
// So the page no longer hands the list to the plugin and the plugin places
// nothing; game/tests/test-2516-server-boards.js holds the server's placing.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split('\r\n').join('\n'); }

const front = read('game/plugins/thornswood-front.js');
const page = read('game/ui/thornswood-board.js');
const gm = read('game/gamemode.js');

// ---------------------------------------------------------- the old list
yes('front.js holds no list of board spots of its own (BOARD_SEEDS is gone)', front.indexOf('BOARD_SEEDS') < 0);

// ------------------------------------------------- the server sends them
{
  const a = gm.indexOf('  function boardsView(profileId) {');
  const b = a < 0 ? -1 : gm.indexOf('\n  }\n', a);
  const fn = b < 0 ? '' : gm.slice(a, b + 4);
  const boards = {
    whiterun: { cell: '3c:Skyrim.esm', pos: [23139.4, -7891.7, -3494.4], facing: 188.4, where: 'Whiterun', seed: 3 },
    ravenrock: { cell: '17ec0:Dragonborn.esm', pos: [-39, -178.2, 0], where: 'Raven Rock', seed: 3 },
    solitude: { cell: '16a0e:Skyrim.esm', pos: [1, 2, 3], where: 'Solitude', placed: 1 }
  };
  const SITES = { solitude: { facing: 9.9 }, whiterun: { facing: 188.4 } };
  let view = null;
  try {
    view = new Function('LEDGER_HOLDS', 'boards', 'boardReads', 'BOARD_SITES', 'wallOf', 'jobsOf',
      fn + '\nreturn boardsView;')(['whiterun', 'solitude', 'ravenrock'], boards, {}, SITES,
        function () { return { rows: [], older: 0 }; }, function () { return []; })(7);
  } catch (e) { console.log('      ' + e); }
  const list = view ? view.list : [];
  const by = {};
  list.forEach(function (t) { by[t.hold] = t; });
  yes('boardsView lists each board with its cell and point',
      !!by.whiterun && by.whiterun.cell === '3c:Skyrim.esm' && by.whiterun.x === 23139.4 &&
      by.whiterun.y === -7891.7 && by.whiterun.z === -3494.4 && by.whiterun.face === 188.4);
  yes('Raven Rock\'s, in The Retching Netch, with its interior cell',
      !!by.ravenrock && by.ravenrock.cell === '17ec0:Dragonborn.esm' && by.ravenrock.x === -39);
  yes('a board a steward walked keeps its town\'s facing, as the object did before',
      !!by.solitude && by.solitude.cell === '16a0e:Skyrim.esm' && by.solitude.face === 9.9);
  yes('and the J tab still has each town\'s name', by.ravenrock && by.ravenrock.where === 'Raven Rock');
}

// --------------------------------------------- the game places none of them
{
  yes('the board page no longer hands the plugin a list of boards to place',
      page.indexOf("tell('spots ") === -1 && page.indexOf('board:spots') === -1);
  yes('and the plugin places, moves and finds no board object of its own',
      front.indexOf('function ensureBoards') === -1 &&
      front.indexOf('function boardsSet') === -1 && front.indexOf("guard('board object'") === -1 &&
      front.indexOf('0x593B') === -1);
  yes('the server stands them, and answers E on them',
      /function standBoard\(hold, anchor\)/.test(gm) && /function boardActivated\(refrId, actorId\)/.test(gm) &&
      gm.indexOf('propBoard.boardActivated(refrId, casterRefrId)') > 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
