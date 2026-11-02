// Compost (#3526): the real crop table and the real farming block out of
// game/gamemode.js against a stubbed mp whose packs keep each entry's name,
// the way the server's do, so a spoiled food named for its food is measured
// going into the ground. Patrick, 26 October 2026, on his report page: a
// Farmer works spoiled food into a plot (#3163, C), and the crop needs a
// quarter less time and gives one more (A+B).
var fs = require('fs');
var path = require('path');
var REPO = path.join(__dirname, '..');
var text = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8'));

function slice(fromMark, toMark, includeTo) {
  var a = text.indexOf(fromMark);
  var b = text.indexOf(toMark, a);
  if (a < 0 || b < 0) { throw new Error('marker missing: ' + fromMark + ' / ' + toMark); }
  return text.slice(a, includeTo ? b + toMark.length : b);
}

var cropCode = slice('var CROPS_BY_BASE = ', 'var CROPS = mergeCrops();', true);
var farmCode = slice('// ==== thornswood farming ====', '// ==== end thornswood farming ====');
var tstart = text.indexOf('    farming: {');
var tend = text.indexOf('\n    }', tstart);
var farmingTuning = eval('({' + text.slice(tstart, tend + 6) + '})').farming;

var pass = 0, fail = 0;
function check(what, ok, detail) {
  if (ok) { pass++; } else { fail++; }
  console.log((ok ? 'PASS  ' : 'FAIL  ') + what);
  if (!ok && detail !== undefined) { console.log('        got: ' + detail); }
}

// ---------------------------------------------------------------- the stubs --
var SPOILED = '19100:Thornswood-Content.esp';
// The spoil block's record, and nothing else of FOOD_GROUPS: the farming
// block reads only that.
var FOOD_GROUPS = { spoil: { spoiled: SPOILED } };
var objects = {}, actors = {};
var ids = {}, nextId = 1;
function idOf(desc) {
  if (!desc) { return 0; }
  if (!Object.prototype.hasOwnProperty.call(ids, desc)) { ids[desc] = ++nextId; }
  return ids[desc];
}
function log() { }
var failInventory = false, failPlot = false;
var mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (Object.prototype.hasOwnProperty.call(actors, id)) {
      var a = actors[id];
      if (key === 'profileId') { return a.profileId; }
      if (key === 'appearance') { return { name: a.name }; }
      if (key === 'inventory') { return { entries: JSON.parse(JSON.stringify(a.inv)) }; }
      if (key === 'worldOrCellDesc') { return a.cell; }
      if (key === 'pos') { return a.pos; }
      return null;
    }
    var o = objects[id];
    if (!o) { throw new Error('no such reference'); }
    if (key === 'baseDesc') { return o.baseDesc; }
    if (key === 'worldOrCellDesc') { return o.cell; }
    if (key === 'pos') { return o.pos; }
    return Object.prototype.hasOwnProperty.call(o.props, key) ? o.props[key] : null;
  },
  set: function (id, key, value) {
    if (Object.prototype.hasOwnProperty.call(actors, id)) {
      if (key === 'inventory') {
        if (failInventory) { throw new Error('inventory refused'); }
        actors[id].inv = JSON.parse(JSON.stringify(value.entries || []));
      }
      if (key === 'thornswoodPlotLine') { actors[id].line = value; }
      return;
    }
    if (failPlot && key === 'thornswoodPlot') { throw new Error('plot refused'); }
    objects[id].props[key] = JSON.parse(JSON.stringify(value));
  },
  getNeighborsByPosition: function (cell, pos) {
    var out = [];
    for (var id in objects) {
      var o = objects[id];
      if (o.cell === cell && Math.abs(o.pos[0] - pos[0]) <= 4096 && Math.abs(o.pos[1] - pos[1]) <= 4096) {
        out.push(Number(id));
      }
    }
    return out;
  }
};
function classGate(actorId) {
  return actors[actorId].cls === 'farmer' ? null : 'Only a farmer can bring a crop in. Ask one.';
}
function toolGate() { return null; }
function wearTool() { return null; }
function rankStep(actorId) { return actors[actorId].step || 0; }
function creditWork() { return null; }
function economyGathered() { }
function mintedEntry(e) { return !!(e && e.minted); }
function count(actorId, desc) {
  var id = idOf(desc), n = 0;
  actors[actorId].inv.forEach(function (e) { if (e.baseId === id) { n += e.count; } });
  return n;
}
function addItem(actorId, desc, n, name) {
  var id = idOf(desc);
  if (!id) { return false; }
  var e = { baseId: id, count: n };
  if (name) { e.name = name; }
  actors[actorId].inv.push(e);
  return true;
}
function takeItem(actorId, desc, n) {
  var id = idOf(desc);
  for (var i = 0; i < actors[actorId].inv.length; i++) {
    var e = actors[actorId].inv[i];
    if (e.baseId !== id) { continue; }
    if (e.count < n) { return false; }
    e.count -= n;
    if (!e.count) { actors[actorId].inv.splice(i, 1); }
    return true;
  }
  return false;
}
function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
var P = { has: own, TABLE: { tuning: { farming: farmingTuning } } };
globalThis.__thornswoodProgression = P;

var work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'thornswood-compost-'));
fs.mkdirSync(path.join(work, 'data'));
var startedIn = process.cwd();
process.chdir(work);
process.on('exit', function () {
  try { process.chdir(startedIn); } catch (e) { }
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { }
});

eval(cropCode + '\n' + farmCode);
var F = globalThis.__thornswoodFarming;

var CELL = '3c:Skyrim.esm';
var CABBAGE = 'bcf48:Skyrim.esm';
function addActor(id, profileId, name, cls, step) {
  actors[id] = { profileId: profileId, name: name, cls: cls, step: step, cell: CELL, pos: [0, 0, 0], inv: [] };
}
function addPlot(id, base) { objects[id] = { baseDesc: base, cell: CELL, pos: [50, 0, 0], props: {} }; }
function plotOf(id) { return objects[id].props.thornswoodPlot; }
var quiet = function () { };

// ------------------------------------------------------------ A the tuning --
check('A1 compostGrow is a quarter less (#3526 A)', farmingTuning.compostGrow === 0.75, farmingTuning.compostGrow);
check('A2 compostExtra is one more (#3526 B)', farmingTuning.compostExtra === 1, farmingTuning.compostExtra);

// ----------------------------------------------------- B the press composts --
addActor(100, 11, 'Brynja', 'farmer', 0);
addPlot(300, CABBAGE);
addItem(100, CROPS[CABBAGE].produce, 1);
F.command('/plant', [], 100, 11, quiet);
var sown = JSON.parse(JSON.stringify(plotOf(300)));
check('B1 the cabbage is sown, and not fed', sown && sown.crop === CABBAGE && !sown.fed, JSON.stringify(sown));
addItem(100, SPOILED, 2, 'Venison (spoiled)');
var said = F.activate(100, 300, CABBAGE);
check('B2 pressing her growing plot with spoiled food works it in',
      /^You work the Venison \(spoiled\) into the ground\. The Cabbage is ready in \d+ minutes? now, and gives one more/.test(said), said);
check('B3 one piece is used', count(100, SPOILED) === 1, count(100, SPOILED));
check('B4 the rest keeps its name', actors[100].inv.some(function (e) { return e.name === 'Venison (spoiled)' && e.count === 1; }),
      JSON.stringify(actors[100].inv));
check('B5 the wait is a quarter less', plotOf(300).ms === Math.round(sown.ms * 0.75), plotOf(300).ms + ' of ' + sown.ms);
check('B6 the sowing time and the rest of the plot stay', plotOf(300).at === sown.at && plotOf(300).by === 11 &&
      plotOf(300).step === sown.step && plotOf(300).fed === 1, JSON.stringify(plotOf(300)));
check('B7 readPlot carries fed', F.readPlot(300).fed === 1, JSON.stringify(F.readPlot(300)));

// ----------------------------------------------------------- C once a plot --
said = F.activate(100, 300, CABBAGE);
check('C1 a second press is only the time', /still growing/.test(said), said);
check('C2 and uses nothing', count(100, SPOILED) === 1, count(100, SPOILED));
check('C3 the wait was cut once', plotOf(300).ms === Math.round(sown.ms * 0.75), plotOf(300).ms);

// ------------------------------------------------- D the harvest, one more --
plotOf(300).at = Date.now() - plotOf(300).ms - 1000;
said = F.activate(100, 300, CABBAGE);
var base = farmingTuning.yieldByRank[0];
check('D1 the bring-in gives one more', said.indexOf('You bring in ' + (base + 1) + ' Cabbage') === 0, said);
check('D2 the produce is in the pack', count(100, CROPS[CABBAGE].produce) === base + 1, count(100, CROPS[CABBAGE].produce));
check('D3 the emptied plot has no fed', !plotOf(300).crop && !plotOf(300).fed, JSON.stringify(plotOf(300)));

// ------------------------------------------ E a plain plot is unchanged --
addPlot(301, CABBAGE);
objects[301].props.thornswoodPlot = { by: 11, crop: CABBAGE, at: Date.now() - 3600000, ms: 60000, step: 0 };
said = F.activate(100, 301, CABBAGE);
check('E1 a plot never fed gives the rank yield', said.indexOf('You bring in ' + base + ' Cabbage') === 0, said);

// ------------------------------------------------------- F who may compost --
addActor(101, 22, 'Kjeld', 'farmer', 0);
addItem(101, SPOILED, 1, 'Apple (spoiled)');
addPlot(302, CABBAGE);
objects[302].props.thornswoodPlot = { by: 11, crop: CABBAGE, at: Date.now(), ms: 1200000, step: 0 };
said = F.activate(101, 302, CABBAGE);
check('F1 somebody else\'s sowing is not theirs to feed', /still growing/.test(said) && count(101, SPOILED) === 1 && !plotOf(302).fed, said);
addActor(102, 33, 'Hunter', 'hunter', 0);
addItem(102, SPOILED, 1, 'Apple (spoiled)');
said = F.activate(102, 302, CABBAGE);
check('F2 somebody with another class is refused before anything', /Only a farmer/.test(said) && count(102, SPOILED) === 1, said);
actors[100].inv = [];
said = F.activate(100, 302, CABBAGE);
check('F3 no spoiled food, no compost', /still growing/.test(said) && !plotOf(302).fed, said);
actors[100].inv = [{ baseId: idOf(SPOILED), count: 1, name: 'Bread (spoiled)', minted: true }];
said = F.activate(100, 302, CABBAGE);
check('F4 an entry another block owns is never taken', /still growing/.test(said) && actors[100].inv.length === 1, said);

// ------------------------------------------ G a write that fails costs nothing --
actors[100].inv = [{ baseId: idOf(SPOILED), count: 1, name: 'Leek (spoiled)' }];
failPlot = true;
said = F.activate(100, 302, CABBAGE);
failPlot = false;
check('G1 a plot that will not take it says so', /would not take it/.test(said) && /Leek \(spoiled\) is back/.test(said), said);
check('G2 the piece is back, named', actors[100].inv.length === 1 && actors[100].inv[0].name === 'Leek (spoiled)', JSON.stringify(actors[100].inv));
check('G3 and the plot is not fed', !plotOf(302).fed, JSON.stringify(plotOf(302)));
failInventory = true;
said = F.activate(100, 302, CABBAGE);
failInventory = false;
check('G4 a pack that cannot be written feeds nothing', /cannot get at your pack/.test(said) && !plotOf(302).fed, said);

// ------------------------------------------------------------- H the line --
F.command('/plot', ['/plot', '12e'], 100, 11, quiet);
check('H1 the line offers compost at her own growing plot', actors[100].line && actors[100].line.e === 'Work in spoiled food',
      JSON.stringify(actors[100].line));
F.activate(100, 302, CABBAGE);
F.command('/plot', ['/plot', '12e'], 100, 11, quiet);
check('H2 and not once it is fed', actors[100].line.e === '', JSON.stringify(actors[100].line));
check('H3 the line says it is composted', /^Cabbage growing, composted, \d+ minutes? to go/.test(actors[100].line.t), actors[100].line.t);
F.command('/plot', ['/plot', '12e'], 101, 22, quiet);
check('H4 nobody else is offered it', actors[101].line.e === '', JSON.stringify(actors[101].line));

// ------------------------------------------------------------ I the docs --
var spoilDoc = fs.readFileSync(path.join(REPO, 'docs', 'systems', 'spoilage.md'), 'utf8');
var farmerDoc = fs.readFileSync(path.join(REPO, 'docs', 'systems', 'classes', 'farmer.md'), 'utf8');
check('I1 spoilage.md says what compost does', /quarter less/.test(spoilDoc) && /one more/.test(spoilDoc) && spoilDoc.indexOf('Not built yet') < 0);
check('I2 farmer.md has compost', /## Compost/.test(farmerDoc) && /Work in spoiled food/.test(farmerDoc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
