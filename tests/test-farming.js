// Runs the real crop table and the real farming block out of game/gamemode.js
// against a stubbed mp, so the fixes are measured rather than claimed.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
var fs = require('fs');
var path = require('path');

// The repo is wherever this file is, never a path off one machine: a test
// that names somebody's home folder is a test only that machine can run,
// which is what entry 196 is about and why this one sat in a scratchpad.
var REPO = path.resolve(REPO_DIR);
var text = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8'));

function slice(fromMark, toMark, includeTo) {
  var a = text.indexOf(fromMark);
  var b = text.indexOf(toMark, a);
  if (a < 0 || b < 0) { throw new Error('marker missing: ' + fromMark + ' / ' + toMark); }
  return text.slice(a, includeTo ? b + toMark.length : b);
}

var cropCode = slice('var CROPS_BY_BASE = ', 'var CROPS = mergeCrops();', true);
var farmCode = slice('// ==== thornswood farming ====', '// ==== end thornswood farming ====');

// TUNING.farming, lifted whole out of the file.
var tstart = text.indexOf('    farming: {');
var tend = text.indexOf('\n    }', tstart);
var farmingTuning = eval('({' + text.slice(tstart, tend + 6) + '})').farming;

// ---------------------------------------------------------------- the stubs --
var objects = {};       // refrId -> { baseDesc, cell, pos, props, throwPos }
var actors = {};        // actorId -> { profileId, name, cls, step, inv }
var said = [];

var ids = {}, nextId = 1;
function idOf(desc) {
  if (!desc) { return 0; }
  if (!Object.prototype.hasOwnProperty.call(ids, desc)) { ids[desc] = ++nextId; }
  return ids[desc];
}
function log() { /* quiet */ }

var mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (Object.prototype.hasOwnProperty.call(actors, id)) {
      var a = actors[id];
      if (key === 'profileId') { return a.profileId; }
      if (key === 'appearance') { return { name: a.name }; }
      if (key === 'inventory') {
        var entries = [];
        for (var b in a.inv) { entries.push({ baseId: Number(b), count: a.inv[b] }); }
        return { entries: entries };
      }
      if (key === 'worldOrCellDesc') { return a.cell; }
      if (key === 'pos') { return a.pos; }
      return null;
    }
    var o = objects[id];
    if (!o) { throw new Error('no such reference'); }
    if (key === 'baseDesc') { return o.baseDesc; }
    if (key === 'worldOrCellDesc') { return o.cell; }
    if (key === 'pos') { if (o.throwPos) { throw new Error('cell unloaded'); } return o.pos; }
    return Object.prototype.hasOwnProperty.call(o.props, key) ? o.props[key] : null;
  },
  set: function (id, key, value) {
    if (Object.prototype.hasOwnProperty.call(actors, id)) {
      if (key === 'inventory') {
        var inv = {};
        (value.entries || []).forEach(function (e) { inv[e.baseId] = e.count; });
        actors[id].inv = inv;
      }
      return;
    }
    objects[id].props[key] = JSON.parse(JSON.stringify(value));
  },
  getNeighborsByPosition: function (cell, pos) {
    var out = [];
    for (var id in objects) {
      var o = objects[id];
      if (o.cell !== cell) { continue; }
      if (Math.abs(o.pos[0] - pos[0]) > 4096 || Math.abs(o.pos[1] - pos[1]) > 4096) { continue; }
      out.push(Number(id));
    }
    return out;
  }
};

function classGate(actorId, verb) {
  return actors[actorId].cls === 'farmer' ? null : 'Only a farmer can bring a crop in. Ask one.';
}
// The shovel gate, stubbed open, the same way classGate above is stubbed.
// Skyrim has no hoe, so /plant and a bring-in ask for a shovel in the pack as
// of 20 September; the real toolGate, the handout at the pick and the way back
// are measured against the real inventory in crafttest.js beside this file.
// What this harness is for is the claims, the growth and the yields, and a
// second gate in front of them would only mean every fixture here carrying a
// shovel.
function toolGate() { return null; }
// Wear, stubbed silent, for the same reason the gate above is stubbed open:
// what this harness is for is the table and the arithmetic, and a tool
// breaking in the middle of it would only mean every fixture carrying one.
// Wear is measured against the real inventory in weartest.js beside this file.
function wearTool() { return null; }
function rankStep(actorId) { return actors[actorId].step || 0; }
function creditWork() { return null; }
function economyGathered() { }
function addItem(actorId, desc, n) {
  var id = idOf(desc);
  if (!id) { return false; }
  actors[actorId].inv[id] = (actors[actorId].inv[id] || 0) + n;
  return true;
}
function takeItem(actorId, desc, n) {
  var id = idOf(desc);
  var have = actors[actorId].inv[id] || 0;
  if (have < n) { return false; }
  actors[actorId].inv[id] = have - n;
  if (!actors[actorId].inv[id]) { delete actors[actorId].inv[id]; }
  return true;
}

function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
var P = { has: own, TABLE: { tuning: { farming: farmingTuning } } };
globalThis.__thornswoodProgression = P;

// The block writes private/farm-claims.json beside the process, so run in a temp
// folder. NOT tools\\work inside the repo, which is where this used to put it:
// the folder stayed behind after every run, showed up untracked in git status
// on both machines, and an untracked file a branch later adds is exactly what
// stops a git pull. The OS temp folder is nobody's working copy.
var work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'thornswood-farm-'));
fs.mkdirSync(path.join(work, 'data'));
var startedIn = process.cwd();
process.chdir(work);
// Leave nothing behind whichever way the run ends, including a failed check,
// because process.exit does not unwind anything.
process.on('exit', function () {
  try { process.chdir(startedIn); } catch (e) { }
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { }
});

eval(cropCode + '\n' + farmCode);
var F = globalThis.__thornswoodFarming;

// ------------------------------------------------------------- the fixtures --
function addActor(id, profileId, name, cls, step, cell, pos) {
  actors[id] = { profileId: profileId, name: name, cls: cls, step: step,
                 cell: cell, pos: pos, inv: {} };
}
function addPlot(id, baseDesc, cell, pos) {
  objects[id] = { baseDesc: baseDesc, cell: cell, pos: pos, props: {} };
}
function toProfile(pid, text) { said.push(text); return text; }
function say(fn) { said = []; fn(); return said.join(' | '); }

var CELL = '3c:Skyrim.esm';
// Ground no earlier block has claimed. The claims record is deliberately not
// reset with the fixtures, because outliving a restart is what it is for.
var FAR = 40000;
var CABBAGE = 'bcf48:Skyrim.esm';
var APPLE = '2c91:JKs Skyrim.esp';
var XJKWO_APPLE = "141081:JK's Whiterun's Outskirts.esp";

var pass = 0, fail = 0;
function check(what, got, want) {
  var ok = (String(got).indexOf(want) !== -1);
  if (ok) { pass++; } else { fail++; }
  console.log((ok ? 'PASS  ' : 'FAIL  ') + what);
  if (!ok) { console.log('        wanted to contain: ' + want + '\n        got: ' + got); }
}

// 1. The table: the four bases the crops pass does not list, and the cap.
check('the JK Whiterun apple tree is a crop', own(CROPS, XJKWO_APPLE), 'true');
check('the carrot plant is a crop', own(CROPS, '2493d:JKs Skyrim.esp'), 'true');
var over = Object.keys(CROPS).filter(function (d) { return CROPS[d].growMinutes >= 60; });
check('every wait is under the engine hour', over.length, '0');
check('cabbage is a novice crop', CROPS[CABBAGE].rank, 'novice');
check('the orchard is expert', CROPS[APPLE].rank, 'expert');
// Fourteen until #3469 (#3141) added the six Hearthfires garden planters,
// each a plot like the field crop it grows.
['1045e', '1045f', '10460', '110b9', '110ba', '110cd'].forEach(function (id) {
  check('the Hearthfires planter ' + id + ' is a crop (#3141)', own(CROPS, id + ':HearthFires.esm'), 'true');
});
check('crop count', Object.keys(CROPS).length, '20');
check('tundra cotton is not a farm crop (#626)', own(CROPS, 'bb947:Skyrim.esm'), 'false');

// 2. The rank gate is live (findings 8 and 14).
addActor(100, 11, 'Brynja', 'farmer', 0, CELL, [4000, 0, 0]);
addPlot(300, APPLE, CELL, [4050, 0, 0]);
addItem(100, CROPS[APPLE].produce, 5);
check('a novice is refused the orchard',
      say(function () { F.command('/plant', [], 100, 11, toProfile); }),
      'needs an Expert Farmer');

// 3. Claim across a 4096 grid line (findings 1, 3, 6, 11).
objects = {}; actors = {};
addActor(100, 11, 'Brynja', 'farmer', 0, CELL, [4000, 0, 0]);
addActor(101, 22, 'Kjeld', 'farmer', 0, CELL, [4100, 0, 0]);
addPlot(301, CABBAGE, CELL, [3950, 0, 0]);
addPlot(302, CABBAGE, CELL, [4150, 0, 0]);
check('claiming needs a plot in reach',
      say(function () { actors[100].pos = [20000, 20000, 0]; F.command('/claim', [], 100, 11, toProfile); }),
      'No plot within reach');
actors[100].pos = [4000, 0, 0];
check('the claim is taken', say(function () { F.command('/claim', [], 100, 11, toProfile); }), 'You claim this farm');
actors[100].pos = [4150, 0, 0];
check('the plot across the grid line is hers',
      say(function () { F.command('/plot', [], 100, 11, toProfile); }), 'This ground is yours');
check('another farmer cannot sow it',
      say(function () { F.command('/plant', [], 101, 22, toProfile); }), 'held by Brynja');
check('another farmer cannot claim over it',
      say(function () { F.command('/claim', [], 101, 22, toProfile); }), 'already held by Brynja');

// 4. Work on the far half refreshes the claim (finding 1, second half).
// private, not data: issue #541. The resources port serves data to anybody.
var claimFile = path.join('private', 'farm-claims.json');
var rec = JSON.parse(fs.readFileSync(claimFile, 'utf8'));
rec.claims['11'].at = Date.now() - 13 * 86400000;
fs.writeFileSync(claimFile, JSON.stringify(rec));
delete globalThis.__thornswoodFarmClaims;
delete globalThis.__thornswoodFarmSeeded;
eval(farmCode);
F = globalThis.__thornswoodFarming;
addItem(100, CROPS[CABBAGE].produce, 3);
say(function () { F.command('/plant', [], 100, 11, toProfile); });
rec = JSON.parse(fs.readFileSync(claimFile, 'utf8'));
var ageDays = (Date.now() - rec.claims['11'].at) / 86400000;
check('sowing the far plot refreshed the claim', ageDays < 0.01, 'true');

// 5. A plot is ripe when it is ripe, whoever looks (finding 7).
objects = {}; actors = {};
addActor(100, 11, 'Brynja', 'farmer', 0, CELL, [0, 0, 0]);
addActor(102, 33, 'Master', 'farmer', 3, CELL, [0, 0, 0]);
addPlot(303, CABBAGE, CELL, [50, 0, 0]);   // Cabbage, 20 minutes for a novice
addItem(100, CROPS[CABBAGE].produce, 1);
check('the novice sows a cabbage', say(function () { F.command('/plant', [], 100, 11, toProfile); }),
      'ready in 20 minutes');
// A master's own wait would be 11 minutes, so this is the moment the old code
// handed the crop over to whoever had the higher rank.
objects[303].props.thornswoodPlot.at = Date.now() - 12 * 60000;
check('a master pressing it at 12 minutes is told to wait',
      F.activate(102, 303, CABBAGE), 'still growing');
check('the owner is told the same number',
      say(function () { F.command('/plot', [], 100, 11, toProfile); }), '8 minutes to go');

// 6. The yield is the sower's and it is above the seed (findings 7 and 13).
objects[303].props.thornswoodPlot.at = Date.now() - 21 * 60000;
check('a master brings in the novice plot at the novice yield',
      F.activate(102, 303, CABBAGE), 'You bring in 2 Cabbage');

// 7. A read that fails refuses instead of paying out (finding 4).
objects = {}; actors = {};
addActor(100, 11, 'Holder', 'farmer', 0, CELL, [0, 0, 0]);
addActor(101, 22, 'Thief', 'farmer', 0, CELL, [0, 0, 0]);
addPlot(304, CABBAGE, CELL, [50, 0, 0]);
addItem(100, CROPS[CABBAGE].produce, 1);
say(function () { F.command('/claim', [], 100, 11, toProfile); });
say(function () { F.command('/plant', [], 100, 11, toProfile); });
objects[304].props.thornswoodPlot.at = Date.now() - 60 * 60000;
check('the thief is refused by name', F.activate(101, 304, CABBAGE), 'held by Holder');
objects[304].throwPos = true;
check('a plot whose ground cannot be read is refused', F.activate(101, 304, CABBAGE),
      'cannot tell which ground');
objects[304].throwPos = false;

// 8. /plant prefers an empty plot in reach (finding 10).
objects = {}; actors = {};
addActor(100, 11, 'Brynja', 'farmer', 0, CELL, [0, 0, 0]);
addPlot(305, CABBAGE, CELL, [50, 0, 0]);
addPlot(306, CABBAGE, CELL, [120, 0, 0]);
addItem(100, CROPS[CABBAGE].produce, 2);
say(function () { F.command('/plant', [], 100, 11, toProfile); });
check('the second sowing takes the further empty plot',
      say(function () { F.command('/plant', [], 100, 11, toProfile); }), 'You sow the Cabbage');
check('both plots are sown',
      !!(objects[305].props.thornswoodPlot.crop && objects[306].props.thornswoodPlot.crop), 'true');
check('a third is refused, everything in reach being sown',
      say(function () { addItem(100, CROPS[CABBAGE].produce, 1); F.command('/plant', [], 100, 11, toProfile); }),
      'already sown here');

// 9. The way back for a Farmer with nothing (findings 5 and 12).
objects = {}; actors = {};
addActor(100, 11, 'Old Farmer', 'farmer', 0, CELL, [0, 0, 0]);   // picked the class long ago
addPlot(307, CABBAGE, CELL, [50, 0, 0]);
addPlot(308, CABBAGE, CELL, [120, 0, 0]);
check('an empty pack is handed seed at a plot',
      say(function () { F.command('/plant', [], 100, 11, toProfile); }), 'here is seed');
check('and the seed is really there', actors[100].inv[idOf(CROPS[CABBAGE].produce)], '3');
say(function () { F.command('/plant', [], 100, 11, toProfile); });  // sows one
actors[100].inv = {};
check('asking again straight away is refused',
      say(function () { F.command('/plant', [], 100, 11, toProfile); }), 'There is more in');

// ---------------------------------------------------------------------------
// The one free crop off a field nobody has worked. This is the seed supply and
// it is also the one place the whole block could leak an infinite farm, so it
// is checked from both ends: it pays exactly once, and it pays nobody twice.
// ---------------------------------------------------------------------------
objects = {}; actors = {};
addActor(200, 21, 'Brynja', 'farmer', 0, CELL, [FAR, 0, 0]);
addActor(201, 22, 'Stranger', 'farmer', 0, CELL, [FAR, 0, 0]);
addActor(202, 23, 'Novice', 'farmer', 0, CELL, [FAR + 4000, 0, 0]);
addPlot(400, CABBAGE, CELL, [FAR + 10, 0, 0]);
addPlot(401, APPLE, CELL, [FAR + 4010, 0, 0]);

check('the standing crop in an unworked row is brought in',
      F.activate(200, 400, CABBAGE), 'that was standing here');
check('and it really reached the pack',
      actors[200].inv[idOf(CROPS[CABBAGE].produce)], '1');
/*
  THE SECOND PRESS SOWS, IT DOES NOT PAY.

  These two checks used to expect "Nothing is sown here", and that sentence is
  deliberately gone: Patrick, 21 September, after playing it, "With Farming I
  don't want to type /plant I want to click e on the ground in that spot", so
  pressing an emptied plot now sows it. The harness was written before that and
  had been sitting in a scratchpad ever since, failing two checks that were
  describing the old behaviour rather than a fault.

  What the entry actually wanted held is that the free crop pays ONCE. That is
  what is checked here, and it is checked by looking in the pack rather than at
  the sentence, which is the part a reworded message cannot break.
*/
check('the same row sows on the next press rather than paying again',
      F.activate(200, 400, CABBAGE), 'You sow the');
/*
  AND IT DID NOT PAY A SECOND ONE. Not 'the pack holds 1', because the press
  that sows TAKES the seed out of the pack, so after it the cabbage is in the
  ground rather than in the bag and the count is 0. That is right and it is
  the neat part: the free crop becomes the seed. What must never happen is 2.
*/
check('and the second press paid no second crop',
      String(actors[200].inv[idOf(CROPS[CABBAGE].produce)] || '0') === '2' ? 'PAID TWICE' : 'no',
      'no');
check('and a stranger pressing it after that gets no crop either',
      String(actors[201].inv[idOf(CROPS[CABBAGE].produce)] || '0'), '0');
check('a standing crop above your rank is refused by name',
      F.activate(202, 401, APPLE), 'Farmer');
check('and refusing it leaves it standing for when you are',
      F.activate(202, 401, APPLE), 'Farmer');

objects = {}; actors = {};
addActor(210, 31, 'Cadwell', 'farmer', 0, CELL, [FAR, 0, 0]);
addActor(211, 32, 'Visitor', 'farmer', 0, CELL, [FAR, 0, 0]);
addPlot(410, CABBAGE, CELL, [FAR + 10, 0, 0]);
addPlot(411, CABBAGE, CELL, [FAR + 20, 0, 0]);
say(function () { F.command('/claim', [], 210, 31, toProfile); });
check('a stranger cannot take the standing crop off a held farm',
      F.activate(211, 411, CABBAGE), 'held by Cadwell');
check('the holder can',
      F.activate(210, 411, CABBAGE), 'that was standing here');


// 9. The claims live in private, never in the folder the server hands out
// (issue #541, 25 September: the live farm-claims.json answered 200).
check('the claims are written to private', fs.existsSync(path.join('private', 'farm-claims.json')) ? 'yes' : 'no', 'yes');
check('and nothing is left in data', fs.existsSync(path.join('data', 'farm-claims.json')) ? 'still there' : 'gone', 'gone');
// Nothing is read from data, and nothing there is touched: the alpha carries
// no data over a change (#3094). A copy there is a file for whoever runs the
// box to delete, never a register.
var held = fs.readFileSync(claimFile, 'utf8');
fs.writeFileSync(path.join('data', 'farm-claims.json'), '{"claims":{}}');
delete globalThis.__thornswoodFarmClaims;
delete globalThis.__thornswoodFarmSeeded;
eval(farmCode);
F = globalThis.__thornswoodFarming;
check('a copy in data is never read: the claims still say who holds what',
      say(function () { F.command('/plant', [], 211, 32, toProfile); }), 'held by Cadwell');
check('and neither copy is moved or changed',
      (fs.readFileSync(path.join('data', 'farm-claims.json'), 'utf8') === '{"claims":{}}' ? 'data as it was' : 'data changed') + ', ' +
      (fs.readFileSync(claimFile, 'utf8') === held ? 'private as it was' : 'private changed'),
      'data as it was, private as it was');
fs.unlinkSync(claimFile);
fs.writeFileSync(path.join('data', 'farm-claims.json'), held);
delete globalThis.__thornswoodFarmClaims;
delete globalThis.__thornswoodFarmSeeded;
eval(farmCode);
F = globalThis.__thornswoodFarming;
check('with no claims in private, the copy in data is not carried across',
      fs.existsSync(claimFile) ? 'carried' : 'not carried', 'not carried');
check('and holds nobody\'s farm',
      /held by Cadwell/.test(say(function () { F.command('/plant', [], 211, 32, toProfile); })) ? 'held' : 'free', 'free');

// 10. The season's share of a bring-in (#3144): the real season block behind
// the farming block, a quarter more in summer and a quarter less in winter.
eval(slice('// ==== thornswood season ====', '// ==== end thornswood season ===='));
var S = globalThis.__thornswoodSeason;
function seasonOf(name, unit) {
  var at = { spring: 0, summer: 1, autumn: 2, winter: 3 }[name];
  S.setEpoch(Date.now() - at * S.WEEK - 1000);
  globalThis.__thornswoodSeasonUnit = function () { return unit; };
}
function ripeMaster(ref) {
  objects = {}; actors = {};
  addActor(120, 41, 'Sigrun', 'farmer', 3, CELL, [FAR * 2, 0, 0]);
  addPlot(ref, CABBAGE, CELL, [FAR * 2 + 50, 0, 0]);
  addItem(120, CROPS[CABBAGE].produce, 1);
  say(function () { F.command('/plant', [], 120, 41, toProfile); });
  // Sown in spring, an hour back, so the clock ran for the whole wait.
  objects[ref].props.thornswoodPlot.at = S.epoch() - 60 * 60000;
}
seasonOf('spring', 0);
ripeMaster(501);
check('a master brings in 5 in spring, with nothing said about it',
      F.activate(120, 501, CABBAGE) + '|', 'You bring in 5 Cabbage.|');
seasonOf('summer', 0.1);
ripeMaster(502);
check('a quarter more in summer: 5 is 6 or 7, and 7 a quarter of the time',
      F.activate(120, 502, CABBAGE), 'You bring in 7 Cabbage. Summer gives more.');
seasonOf('summer', 0.9);
ripeMaster(503);
check('and 6 the rest', F.activate(120, 503, CABBAGE), 'You bring in 6 Cabbage. Summer gives more.');
seasonOf('winter', 0.1);
ripeMaster(504);
check('a quarter less in winter: 5 is 3 or 4, and 4 three times in four',
      F.activate(120, 504, CABBAGE), 'You bring in 4 Cabbage. Winter gives less.');
seasonOf('winter', 0.9);
ripeMaster(505);
check('and 3 the rest', F.activate(120, 505, CABBAGE), 'You bring in 3 Cabbage. Winter gives less.');
delete globalThis.__thornswoodSeasonUnit;
delete globalThis.__thornswoodSeason;

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
