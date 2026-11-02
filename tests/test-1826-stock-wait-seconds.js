// test-1826-stock-wait-seconds.js
//
// #1826. Since #1413 fish() and game() read the shared resource stock, and
// stock.left answers in milliseconds. Both handed that straight to waitWord,
// which takes seconds, so a river with ten minutes left said 'This water is
// fished out for now. 166 hours and 40 minutes to go.' The churn, nest, hive
// and milk lines read cooldownLeft, which answers in seconds, and were right.
//
// This slices the production stock block, fish(), game() and waitWord() out of
// game/gamemode.js and runs them against a stand-in for mp whose clock is the
// test's, so the stock answers in real milliseconds, and reads the line a
// person is told at each wait.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = require('./gamemode-tables.js').joined(fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'game', 'gamemode.js'), 'utf8'))
  .split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function fn(name) {
  const m = source.match(new RegExp('^function ' + name + '\\([^\\n]*\\)[\\s\\S]*?^\\}', 'm'));
  if (!m) { throw new Error('no function ' + name + ' in gamemode.js'); }
  return m[0];
}
function table(name) {
  const m = source.match(new RegExp('^(?:var|const) ' + name + ' = (?:\\{[^\\n]*\\};$|\\{[\\s\\S]*?^\\};)', 'm'));
  if (!m) { throw new Error('no table ' + name + ' in gamemode.js'); }
  return m[0];
}
const begin = source.indexOf('// SHARED RESOURCE STOCK BEGIN'), end = source.indexOf('// SHARED RESOURCE STOCK END');
if (begin < 0 || end < begin) { throw new Error('no SHARED RESOURCE STOCK block in gamemode.js'); }

// ---- the source, read -------------------------------------------------------
const fishSrc = fn('fish'), gameSrc = fn('game');
yes('fish() hands waitWord the stock\'s milliseconds as seconds',
  /const waitMs = stock\.left\(refrId,span\);\s*if \(waitMs > 0\) \{\s*return 'This water is fished out for now\. ' \+ waitWord\(waitMs \/ 1000\) \+ ' to go\.';/.test(fishSrc));
yes('game() does the same',
  /const waitMs = stock\.left\(refrId,span\);\s*if \(waitMs > 0\) \{\s*return 'This one is picked clean for now\. ' \+ waitWord\(waitMs \/ 1000\) \+ ' to go\.';/.test(gameSrc));
yes('no waitWord call anywhere is handed what stock.left answered unconverted',
  !/waitWord\(\s*stock\.left/.test(source) && !/const wait = stock\.left/.test(source));

// ---- the press, run -----------------------------------------------------------
const code = [source.slice(begin, end),
  ...['FISH_BY_BASE', 'FISH_TUNING', 'GAME_BY_BASE', 'GAME_TUNING', 'RACKS_BY_HAND', 'RACK_OWNERS'].map(table),
  "const RANK_LADDER=['novice','advanced','expert','master'];",
  ...['isFish', 'isGame', 'idOf', 'mintedEntry', 'addItem', 'addItemsAtomic', 'waitWord', 'classGate', 'rankStep', 'rankWord',
    'creditWork', 'economyGathered', 'withinResourceReach', 'fish', 'rackOf', 'game'].map(fn)].join('\n');
const copy = v => v == null ? null : JSON.parse(JSON.stringify(v));
let time = 1000000000;
const values = new Map();
const mp = {
  makeProperty() {},
  get(id, name) { return copy(values.get(id + ':' + name)); },
  set(id, name, value) { values.set(id + ':' + name, copy(value)); },
  getIdFromDesc(desc) { return parseInt(desc.split(':')[0], 16); }
};
for (const id of [1, 2]) {
  values.set(id + ':inventory', { entries: [] });
  values.set(id + ':locationalData', { pos: [0, 20, 0], rot: [0, 0, 0], cellOrWorldDesc: '3c:Skyrim.esm' });
}
for (const ref of [71, 72, 73, 74]) {
  values.set(ref + ':locationalData', { pos: [0, 0, 0], rot: [0, 0, 0], cellOrWorldDesc: '3c:Skyrim.esm' });
  values.set(ref + ':type', 'MpObjectReference');
}
const context = { mp, Math, Date: { now: () => time }, Number, Map, Set, JSON, log() {},
  toolGate() { return null; }, wearTool() { return null; }, randInt: (a) => a };
vm.createContext(context);
vm.runInContext(code, context);
// 1 is a master fisher, 2 a master hunter
context.__thornswoodCharacter = {
  gate(id, verb) { return (verb === 'fish' ? id === 1 : id === 2) ? null : 'This work belongs to another class.'; },
  rankOf() { return 'master'; },
  credit() { return null; }
};
context.__thornswoodResourceStock = context.createSharedResourceStock(mp, () => time);
const stock = context.__thornswoodResourceStock;

function firstOf(tbl, rank) { return Object.keys(tbl).find(k => tbl[k].rank === rank); }
const noviceFish = firstOf(context.FISH_BY_BASE, 'novice');
// Longfin markers require the quest controller. Use an ordinary master nest
// for the stock-duration regression and separately prove the reserved water
// cannot fall through when that controller is unavailable.
const longfin = '154a5:Thornswood-Content.esp';
const masterFish = Object.keys(context.FISH_BY_BASE).find(k => k !== longfin && context.FISH_BY_BASE[k].rank === 'master');
const noviceRack = firstOf(context.GAME_BY_BASE, 'novice'), expertRack = firstOf(context.GAME_BY_BASE, 'expert');
yes('the tables have a novice and a master water, a novice and an expert rack',
  !!noviceFish && !!masterFish && !!noviceRack && !!expertRack);

const t0 = time;
yes('a novice water gives a catch', /^You take /.test(context.fish(1, 71, noviceFish)));
yes('the stock counts its wait in milliseconds: ' + stock.left(71, 600000), stock.left(71, 600000) === 600000);
let line = context.fish(1, 71, noviceFish);
yes('with ten minutes left the water says so: "' + line + '"', line === 'This water is fished out for now. 10 minutes to go.');
yes('and not the 166 hours of #1826', line.indexOf('166 hours') < 0);
time = t0 + 9 * 60000 + 30000;
line = context.fish(1, 71, noviceFish);
yes('with thirty seconds left: "' + line + '"', line === 'This water is fished out for now. 30 seconds to go.');
time = t0 + 600000 - 1;
line = context.fish(1, 71, noviceFish);
yes('with one millisecond left it says a second, not nothing: "' + line + '"', line === 'This water is fished out for now. 1 second to go.');
time = t0 + 600000;
yes('at ten minutes the water gives again', /^You take /.test(context.fish(1, 71, noviceFish)));

const t1 = time;
yes('reserved longfin cannot give an ordinary catch without its quest controller',
  context.fish(1, 72, longfin) === 'This longfin water is unavailable for now.' && stock.left(72, 14400000) === 0);
yes('a master water gives a catch', /^You take /.test(context.fish(1, 72, masterFish)));
time = t1 + 15 * 60000;
line = context.fish(1, 72, masterFish);
yes('a master water fifteen minutes on: "' + line + '"', line === 'This water is fished out for now. 3 hours and 45 minutes to go.');

const t2 = time;
yes('a novice rack gives', /^You take /.test(context.game(2, 73, noviceRack)));
line = context.game(2, 73, noviceRack);
yes('with ten minutes left the rack says so: "' + line + '"', line === 'This one is picked clean for now. 10 minutes to go.');
time = t2 + 600000;
yes('at ten minutes the rack gives again', /^You take /.test(context.game(2, 73, noviceRack)));

const t3 = time;
yes('an expert rack gives', /^You take /.test(context.game(2, 74, expertRack)));
time = t3 + 59 * 60000;
line = context.game(2, 74, expertRack);
yes('an expert rack with a minute left: "' + line + '"', line === 'This one is picked clean for now. 1 minute to go.');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
