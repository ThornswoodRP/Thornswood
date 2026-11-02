// test-1382-tea.js
//
// #1382, docs/systems/exhaustion.md "A stimulant": "A tea holds the rest drain
// at half for 20 real minutes, then costs 15 rest more than those 20 minutes
// would have. ... A second dose inside the window does not stack. It
// refreshes the clock and adds the crash again." Patrick, 12 Oct 2026,
// decision 4 on #1382: tea items in the content plugin, brewed at a cooking
// pot.
//
// Root cause: no item in the load order was a tea, so the needs block had no
// tea to know. The teas are Thornswood-Content.esp's (scripts/mods/
// Add-ContentRecords.py, TEAS), group tea in game/data/food-groups.json.
//
// Runs the REAL needs block over a stand-in mp and clock, and reads the
// committed plugin for the records. Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
// From its file when the gamemode reads it from one (#5191), else its line.
function table(name) { return require('./gamemode-tables.js').inGamemode(gm, name); }
const a = gm.indexOf('// ==== thornswood needs: hunger, thirst and exhaustion ====');
const b = gm.indexOf('// ==== end thornswood needs ====');
const needsBlock = (a >= 0 && b > a) ? gm.slice(a, b) : null;
const FOODS = table('FOODS'), GROUPS = table('FOOD_GROUPS');
const TEAS = ['18001:Thornswood-Content.esp', '18002:Thornswood-Content.esp', '18003:Thornswood-Content.esp'];
const SKOOMA = '57a7a:Skyrim.esm';

// The plugin: every record of one type in its top group, with its subrecords.
function records(buf, tag) {
  const out = [];
  let p = 24 + buf.readUInt32LE(4);
  while (p + 24 <= buf.length) {
    const size = buf.readUInt32LE(p + 4);
    if (buf.toString('latin1', p, p + 4) === 'GRUP' && buf.toString('latin1', p + 8, p + 12) === tag) {
      let q = p + 24;
      while (q < p + size) {
        const rs = buf.readUInt32LE(q + 4);
        const subs = {}; let k = q + 24;
        while (k + 6 <= q + 24 + rs) {
          const t = buf.toString('latin1', k, k + 4), n = buf.readUInt16LE(k + 4);
          (subs[t] = subs[t] || []).push(buf.slice(k + 6, k + 6 + n));
          k += 6 + n;
        }
        out.push({ fid: buf.readUInt32LE(q + 12), subs: subs });
        q += 24 + rs;
      }
    }
    p += buf.toString('latin1', p, p + 4) === 'GRUP' ? size : 24 + size;
  }
  return out;
}
const esp = fs.readFileSync(path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp'));
const own = 5 << 24;   // the plugin's own records: five masters before it
const alch = records(esp, 'ALCH'), cobj = records(esp, 'COBJ'), mgef = records(esp, 'MGEF');
function local(d) { return own | parseInt(d.split(':')[0], 16); }

yes('three teas are in the tea group', !!GROUPS && TEAS.every(function (d) { return GROUPS.items[d] === 'tea'; }));
yes('and the food table knows each of them, read from the plugin', !!FOODS && TEAS.every(function (d) { return !!FOODS.items[d]; }));
TEAS.forEach(function (d) {
  const rec = alch.find(function (r) { return r.fid === local(d); });
  const enit = rec && rec.subs.ENIT && rec.subs.ENIT[0];
  yes(d + ' is an ALCH in the plugin, a food item', !!enit && (enit.readUInt32LE(4) & 2) === 2);
  const effect = rec && rec.subs.EFID && rec.subs.EFID[0].readUInt32LE(0);
  const fx = mgef.find(function (r) { return r.fid === effect; });
  yes(d + ' carries the steep effect, a script effect with no script', !!fx &&
    fx.subs.DATA[0].readUInt32LE(0x40) === 1 && !fx.subs.VMAD);
  const made = cobj.find(function (r) { return r.subs.CNAM && r.subs.CNAM[0].readUInt32LE(0) === local(d); });
  yes(d + ' is brewed at the cooking pot', !!made && made.subs.BNAM[0].readUInt32LE(0) === 0xA5CB3);
});

const ids = {}; let next = 0x100;
[FOODS, GROUPS].forEach(function (t) { if (t) { for (const d in t.items) { if (!ids[d]) { ids[d] = next++; } } } });
function idOf(d) { return ids[d] || 0; }
const clock = { now: Date.UTC(2026, 9, 20, 18, 0, 0) };
const store = {};
const mp = {
  makeProperty: function () { },
  get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return []; } if (key === 'worldOrCellDesc' || key === 'pos') { return null; } return store[id]; },
  set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
};
let N = null;
try {
  N = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', 'FOODS', 'FOOD_GROUPS', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    { __thornswoodHurt: { exposed: function () { return false; } } }, mp,
    { now: function () { return clock.now; } }, { log: function () { } }, function () { return 0; }, function () { },
    function (n, f) { return f; }, function () { }, function () { }, idOf, FOODS, GROUPS);
} catch (e) { console.log('rig threw: ' + e.message); }
const NEEDS = N && N.NEEDS;
yes('the tea is one config row: 20 minutes at half, then 15 rest', !!NEEDS && !!NEEDS.tea &&
  NEEDS.tea.holdMinutes === 20 && NEEDS.tea.share === 0.5 && NEEDS.tea.crashRest === 15);

if (N && NEEDS && NEEDS.tea) {
  let who = 1;
  function person() {
    const id = who++;
    const n = N.fresh(); n.at = clock.now; n.food = 50; n.drink = 50; n.rest = 80; store[id] = n;
    return id;
  }
  const rate = NEEDS.drain.rest;   // per hour
  function near(x, y) { return Math.abs(x - y) < 0.01; }

  TEAS.forEach(function (d) {
    const A = person();
    N.consumed(A, idOf(d));
    yes(d + ': a drink, 20 thirst and no hunger', near(store[A].drink, 70) && near(store[A].food, 50));
  });

  const A = person();
  N.consumed(A, idOf(TEAS[0]));
  const rest0 = store[A].rest;
  clock.now += 10 * 60000; N.settle(A);
  yes('inside the 20 minutes rest drains at half', near(rest0 - store[A].rest, rate * 10 / 60 / 2));
  clock.now += 15 * 60000; N.settle(A);
  // 10 more minutes at half, then 5 at the full rate, and the 15 owed.
  yes('then 15 rest is owed, and the drain is whole again',
    near(rest0 - store[A].rest, rate * 20 / 60 / 2 + rate * 5 / 60 + 15));
  clock.now += 10 * 60000; N.settle(A);
  yes('and it is owed once', near(rest0 - store[A].rest, rate * 20 / 60 / 2 + rate * 15 / 60 + 15));

  // A second cup inside the window: the clock starts again and a second 15 is owed.
  const B = person();
  N.consumed(B, idOf(TEAS[1]));
  const restB = store[B].rest;
  clock.now += 10 * 60000;
  N.consumed(B, idOf(TEAS[2]));
  clock.now += 15 * 60000; N.settle(B);
  yes('a second cup refreshes the clock: still at half 25 minutes after the first',
    near(restB - store[B].rest, rate * 25 / 60 / 2));
  clock.now += 10 * 60000; N.settle(B);
  yes('and owes the crash again: 30 rest when the refreshed window ends',
    near(restB - store[B].rest, rate * 30 / 60 / 2 + rate * 5 / 60 + 30));

  // Tea and skooma together: the drug's zero wins while both run.
  const C = person();
  N.consumed(C, idOf(TEAS[0]));
  N.consumed(C, idOf(SKOOMA));
  const restC = store[C].rest;
  clock.now += 5 * 60000; N.settle(C);
  yes('with skooma in you as well, the drain is held at zero, not half', near(store[C].rest, restC));
  clock.now += 10 * 60000; N.settle(C);
  // 10 minutes of skooma at zero, then 5 of tea at half; the skooma crash is 30.
  yes('and the tea holds at half once the skooma window ends', near(restC - store[C].rest, rate * 5 / 60 / 2 + 30));

  // The window survives a read.
  const D = person();
  N.consumed(D, idOf(TEAS[0]));
  const kept = N.read(D);
  yes('a read keeps the window and the crash owed', kept.teaUntil === clock.now + 20 * 60000 && kept.teaCrash === 1);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
