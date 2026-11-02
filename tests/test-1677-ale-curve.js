// test-1677-ale-curve.js
//
// #1677. drink.md: "Inside 45 real minutes, each ale is worse than the last",
// with a table of what the 1st to 4th give back and cost. consumed() read the
// count through settle(), and read() rebuilt the record without ale or aleAt,
// so every ale was the first: the same line and the same cost four times.
//
// The REAL needs block runs over a stand-in mp and a clock turned by hand.
// Four ales are drunk a few minutes apart; each one's line and its cost to
// thirst, rest and hunger are checked against the page's table (which is
// rounded to whole points, so within half a point). Then one more after 46
// minutes with none is the first again.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const page = fs.readFileSync(path.join(ROOT, 'docs', 'systems', 'drink.md'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(start, end) {
  const a = gm.indexOf(start);
  if (a < 0) { return null; }
  const b = gm.indexOf(end, a + start.length);
  return b < 0 ? null : gm.slice(a, b + end.length);
}

const needsBlock = slice('// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
yes('the needs block is in the gamemode', !!needsBlock);
if (!needsBlock) { done(); }

// The page's table: | 1st | 30 | -8 | -6 | and so on.
const table = {};
page.replace(/^\| (\d)(?:st|nd|rd|th) \| (-?\d+) \| (-?\d+) \| (-?\d+) \|$/gm, function (m, i, d, r, f) {
  table[Number(i)] = { drink: Number(d), rest: Number(r), food: Number(f) };
  return m;
});
yes('the page has a row for each of the first four ales', [1, 2, 3, 4].every(function (i) { return !!table[i]; }));
if (![1, 2, 3, 4].every(function (i) { return !!table[i]; })) { done(); }

const ME = 0xff000001;
const ALE = 0x34c5e;
const store = {};
const clock = { now: Date.UTC(2026, 9, 10, 20, 0, 0) };
const N = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
  'guard', 'notify', 'say', 'FOODS', 'idOf', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
  {}, {
    makeProperty: function () { },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return [ME]; } return key === 'worldOrCellDesc' ? 'cell:X.esm' : store[id]; },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  }, { now: function () { return clock.now; } }, { log: function () { } },
  function () { return 0; }, function () { }, function (n, f) { return f; },
  function () { }, function () { },
  // The food table with only the ale in it, as the gamemode's FOODS has it.
  { items: { '34c5e:Skyrim.esm': { k: 'ale' } } },
  function (desc) { return desc === '34c5e:Skyrim.esm' ? ALE : 0; });
N.settle(ME);

/* One ale from meters at 50, settled just now, keeping the ale count. */
function drink() {
  const n = N.settle(ME);
  n.food = 50; n.drink = 50; n.rest = 50; n.at = clock.now;
  store[ME] = JSON.parse(JSON.stringify(n));
  const said = N.consumed(ME, ALE);
  const after = store[ME];
  return { said: said, drink: after.drink - 50, rest: after.rest - 50, food: after.food - 50, ale: after.ale };
}
const near = (a, b) => Math.abs(a - b) <= 0.5;
const lines = ['You drink it down. It goes well.',
               'The second one is going down easier than it should.',
               'Three in. You are hungry and your legs know it.',
               'Four. You will feel this tomorrow.'];

for (let i = 1; i <= 4; i++) {
  const d = drink();
  const want = table[i];
  yes('ale ' + i + ' says its own line (' + d.said + ')', typeof d.said === 'string' && d.said.indexOf(lines[i - 1]) === 0);
  yes('ale ' + i + ' costs what the page says: thirst ' + d.drink.toFixed(1) + ' (' + want.drink + '), rest ' +
      d.rest.toFixed(1) + ' (' + want.rest + '), hunger ' + d.food.toFixed(1) + ' (' + want.food + ')',
      near(d.drink, want.drink) && near(d.rest, want.rest) && near(d.food, want.food));
  yes('ale ' + i + ' is counted', d.ale === i);
  clock.now += 5 * 60000;
}

clock.now += 46 * 60000;
const fresh = drink();
yes('after 46 minutes with none, the next is the first again', fresh.said.indexOf(lines[0]) === 0 &&
    near(fresh.drink, table[1].drink) && near(fresh.rest, table[1].rest) && fresh.ale === 1);

done();
