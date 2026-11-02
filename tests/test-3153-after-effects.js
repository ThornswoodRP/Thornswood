// test-3153-after-effects.js
//
//     node tests/test-3153-after-effects.js
//
// #3153: drunk and high wear off with balanced after-effects. Patrick, 22 Oct
// 2026, A on his report page: "Hangover: stamina regen down 25% for 10
// minutes. Withdrawal after 3 uses in a day: stamina and magicka regen down
// 10% for 30 minutes", and "I also want visual affects" for drunk, high,
// hangover and withdrawal. docs/systems/drink.md, exhaustion.md.
//
// Root cause: the hangover (#1382) only came from logging out drunk, read rest
// as weary until a bed, and nothing followed being drunk wearing off in the
// world; a drug left nothing behind but its crash; and only drunk had a look.
//
// Drives the real needs block over a stand-in mp and clock. Read only.
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
const block = (a >= 0 && b > a) ? gm.slice(a, b) : null;
const FOODS = table('FOODS'), GROUPS = table('FOOD_GROUPS');
const ids = {}; let next = 0x100;
[FOODS, GROUPS].forEach(function (t) { if (t) { for (const d in t.items) { if (!ids[d]) { ids[d] = next++; } } } });
function idOf(d) { return ids[d] || 0; }
const ALE = '34c5e:Skyrim.esm';
const SKOOMA = '57a7a:Skyrim.esm';
const MIN = 60000, HOUR = 3600000;
const ME = 0xff000001;

function rig() {
  const clock = { now: Date.UTC(2026, 9, 26, 18, 0, 0) };
  const store = {};
  const online = [];
  const said = [];
  const cared = [];
  const mp = {
    makeProperty: function () { },
    getDescFromId: function () { return ''; },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); } if (key === 'worldOrCellDesc') { return 'cell:X.esm'; } if (key === 'pos') { return null; } return store[id]; },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  };
  const g = { __thornswoodHurt: { exposed: function () { return false; }, careChanged: function (id) { cared.push(id); } } };
  const N = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', 'FOODS', 'FOOD_GROUPS', block + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, { now: function () { return clock.now; } }, { log: function () { } }, function () { return 0; }, function () { },
    function (n, f) { return f; }, function (id, line) { said.push(line); }, function () { }, idOf, FOODS, GROUPS);
  N.clock = clock; N.store = store; N.online = online; N.said = said; N.cared = cared;
  N.online.push(ME);
  const n = N.fresh(); n.at = clock.now; n.food = 70; n.drink = 70; n.rest = 90; store[ME] = n;
  N.settle(ME);
  // Time passes in the world: the 20 second tick, as the server runs it.
  N.walk = function (ms) {
    const end = clock.now + ms;
    while (clock.now < end) { clock.now = Math.min(end, clock.now + 20000); N.tick(); }
  };
  // What the after-effects cost, measured on full meters so a band moving
  // under hours of walking is not counted as one.
  N.cost = function () {
    const n = N.read(ME); n.food = 100; n.drink = 100; n.rest = 100; n.temp = N.NEEDS.comfort;
    return N.effects(ME, n);
  };
  return N;
}

let probe = null;
try { probe = block ? rig() : null; } catch (e) { console.log('rig threw: ' + e.message); }
yes('the needs block runs', !!probe);

if (probe) {
  const A = probe.NEEDS.ale, W = probe.NEEDS.drug.withdrawal;
  yes('a hangover is 10 minutes of stamina recovery down 25%', A.hangoverMinutes === 10 &&
    JSON.stringify(A.hangover) === JSON.stringify({ staminaRateMult: -25 }));
  yes('withdrawal is after 3 uses in a day: 30 minutes of stamina and magicka recovery down 10%',
    W.uses === 3 && W.dayHours === 24 && W.minutes === 30 &&
    JSON.stringify(W.cost) === JSON.stringify({ staminaRateMult: -10, magickaRateMult: -10 }));

  // DRUNK WEARS OFF IN THE WORLD INTO A HANGOVER.
  {
    const r = rig();
    const plain = r.cost().staminaRateMult || 0;
    r.consumed(ME, idOf(ALE)); r.consumed(ME, idOf(ALE)); r.consumed(ME, idOf(ALE));
    const drankAt = r.clock.now;
    yes('three ales: drunk, and the screen says so', r.read(ME).drunk === true && r.read(ME).look === 'drunk');
    r.walk(44 * MIN);
    yes('no hangover while still drunk', r.hungOver(ME) === false && (r.cost().staminaRateMult || 0) === plain);
    r.walk(2 * MIN);
    const n = r.read(ME);
    yes('the 45 minutes pass: hung over, for 10 minutes from the moment they did',
      n.drunk === false && n.hangoverUntil === drankAt + 55 * MIN);
    yes('stamina recovers 25% slower', (r.cost().staminaRateMult || 0) - plain === -25);
    yes('the screen turns to the hangover look', n.look === 'hangover');
    yes('it is said once', r.said.filter(function (l) { return l === A.hungLine; }).length === 1);
    yes('and a remedy can be offered for it', r.cared.length === 1);
    r.walk(10 * MIN);
    yes('10 minutes on it is gone: recovery as it was and nothing on the screen',
      r.hungOver(ME) === false && (r.cost().staminaRateMult || 0) === plain && r.read(ME).look === '');
    yes('and the remedy is no longer offered for it', r.cared.length === 2);
  }

  // WITHDRAWAL AFTER THE THIRD DOSE IN A DAY.
  {
    const r = rig();
    const plain = r.cost();
    r.consumed(ME, idOf(SKOOMA));
    yes('a dose: the screen says high', r.read(ME).look === 'high');
    r.walk(2 * HOUR);
    r.consumed(ME, idOf(SKOOMA));
    r.walk(2 * HOUR);
    yes('two doses in a day: no withdrawal', !(r.read(ME).withdrawalUntil > r.clock.now) &&
      JSON.stringify(r.cost()) === JSON.stringify(plain) && r.read(ME).look === '');
    r.consumed(ME, idOf(SKOOMA));
    const third = r.clock.now;
    r.walk(10 * MIN + 20000);
    const n = r.read(ME);
    yes('the third: withdrawal from the end of its window, for 30 minutes',
      n.withdrawalUntil === third + 40 * MIN);
    const c = r.cost();
    yes('stamina and magicka recover 10% slower',
      (c.staminaRateMult || 0) - (plain.staminaRateMult || 0) === -10 &&
      (c.magickaRateMult || 0) - (plain.magickaRateMult || 0) === -10);
    yes('the screen turns to the withdrawal look', n.look === 'withdrawal');
    yes('it is said once', r.said.filter(function (l) { return l === W.line; }).length === 1);
    r.walk(30 * MIN);
    yes('30 minutes on it is gone', JSON.stringify(r.cost()) === JSON.stringify(plain) &&
      r.read(ME).withdrawalUntil === 0 && r.read(ME).look === '');
  }
  {
    const r = rig();
    r.consumed(ME, idOf(SKOOMA)); r.walk(13 * HOUR);
    r.consumed(ME, idOf(SKOOMA)); r.walk(13 * HOUR);
    r.consumed(ME, idOf(SKOOMA)); r.walk(11 * MIN);
    yes('three doses spread over more than a day: no withdrawal', !(r.read(ME).withdrawalUntil > r.clock.now));
    yes('and the doses kept are only those of the last day', r.read(ME).doses.length === 2);
  }
  {
    // The third dose, then logged out before its window ends: withdrawal
    // starts on the way back in, as a hangover does.
    const r = rig();
    r.consumed(ME, idOf(SKOOMA)); r.walk(1 * HOUR);
    r.consumed(ME, idOf(SKOOMA)); r.walk(1 * HOUR);
    r.consumed(ME, idOf(SKOOMA)); r.walk(2 * MIN);
    r.online.length = 0; r.tick();
    r.clock.now += 3 * HOUR;
    r.online.push(ME); r.settle(ME);
    yes('third dose, logged out high, back 3 hours later: withdrawal from the way back in',
      r.read(ME).withdrawalUntil === r.clock.now + 30 * MIN);
  }

  // ONE LOOK AT A TIME.
  {
    const r = rig();
    r.consumed(ME, idOf(ALE)); r.consumed(ME, idOf(ALE)); r.consumed(ME, idOf(ALE));
    r.walk(1 * MIN);
    r.consumed(ME, idOf(SKOOMA));
    yes('drunk and high: the high shows', r.read(ME).look === 'high');
    r.walk(11 * MIN);
    yes('the high over, still drunk: the drunk look again', r.read(ME).look === 'drunk');
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
