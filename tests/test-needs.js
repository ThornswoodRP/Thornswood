// test-needs.js
//
// Hunger, thirst and exhaustion: the arithmetic, the bands and the penalties.
//
// Blade Da Razor's pitch, 22 September, and Patrick: "you csn invent the
// balance and we an go form there". Every number in NEEDS is invented, so
// what this checks is not whether they are RIGHT, which nobody can know until
// somebody plays it. It checks that they are what the pitch asked for and that
// the machinery around them does what it says.
//
// The three shapes from the pitch, which are the only claims here that are not
// mine to change freely:
//   - drink goes twice as fast as food
//   - rest is over three times the food meter
//   - low anything costs you, and low rest costs you everything
//
// It drives the REAL block out of gamemode.js over a fake mp and a fake clock,
// the way test-deposit.js does, so a number changed in the gamemode shows up
// here and not in a copy of it.
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

const A = '// ==== thornswood needs: hunger, thirst and exhaustion ====';
const B = '// ==== end thornswood needs ====';
const a = src.indexOf(A);
const b = a < 0 ? -1 : src.indexOf(B, a);
let block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;

/*
  The block is an IIFE that publishes itself on the global and starts a timer.
  It is run with a fake global, a fake mp and a fake clock, and the timer is
  swallowed. Everything it needs from the rest of the gamemode (notify, say,
  guard, mp) is passed in. Everybody with meters is online, until leave()
  takes them out and runs the block's own tick, the way logging out looks to
  it (#1606).
*/
function rig(startAt) {
  const store = {};
  const clock = { now: startAt || 1000000000000 };
  const said = [];
  const g = {};
  const gone = {};
  const named = {};
  const Fake = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return Object.keys(store).map(Number).filter(function (id) { return !gone[id]; }); }
      if (key === 'worldOrCellDesc') { return (store[id] && store[id].cell) || 'cell:X.esm'; }
      return store[id] ? store[id].v : undefined;
    },
    set: function (id, key, v) {
      if (!store[id]) { store[id] = {}; }
      store[id].v = v;
    }
  };
  const FakeDate = { now: function () { return clock.now; } };
  const fn = new Function(
    'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'Math', 'Number', 'String', 'Object', 'isFinite',
    block + '\nreturn globalThis.__thornswoodNeeds;');
  const api = fn(
    g, Fake, FakeDate, { log: function () { } },
    function () { return 0; }, function () { },
    function (n, f) { named[n] = f; return f; },
    function (id, line) { said.push(line); },
    function (id, line) { said.push(line); },
    Math, Number, String, Object, isFinite);
  api.clock = clock;
  api.leave = function (id) { gone[id] = true; named.needsTick(); };
  api.back = function (id) { delete gone[id]; };
  api.said = said;
  api.cellOf = function (id, c) { if (!store[id]) { store[id] = {}; } store[id].cell = c; };
  api.seed = function (id) { Fake.set(id, 'x', api.fresh()); };
  return api;
}

let smoke = null;
if (block !== null) {
  try { smoke = rig(); } catch (e) { console.log('  (' + e.message + ')'); block = null; }
}
yes('the needs block is in the gamemode and runs', block !== null && !!smoke);

if (block !== null && smoke) {
  const HOUR = 3600000;
  const ME = 0xff000001;

  // S1: the three rates are the shape the pitch asked for.
  {
    const r = rig();
    const d = r.NEEDS.drain;
    yes('S1 drink goes exactly twice as fast as food',
        Math.abs(d.drink / d.food - 2) < 1e-9);
    yes('S1 rest is more than three times the food meter',
        (100 / d.rest) / (100 / d.food) > 3);
    /*
      TWO AND A HALF TIMES FASTER, and this check used to hold the old shape
      down: it wanted four hours or more. Patrick, 23 September, after playing
      with it: "I think the food, water, and rest go down wayyyyy to slowly
      like it needs to go down 2.5x this speed". A session is two hours and
      nothing ever moved far enough to matter. Food is two hours and twenty
      four minutes now.
    */
    yes('S1 and food empties inside a long session rather than an evening',
        (100 / d.food) > 2 && (100 / d.food) < 3);
  }

  // S2: a meter empties on the clock, and stops at nothing. Settled once
  // first, so the three hours are spent in the world: the first settle of
  // somebody is their arrival, and the time before it is time away, which
  // since #2246 costs half the clock with a floor of 25 (test-2246).
  {
    const r = rig();
    r.seed(ME);
    r.settle(ME);
    r.clock.now += 3 * HOUR;
    let n = r.settle(ME);
    yes('S2 after three hours drink is long empty and so is food',
        Math.round(n.drink) === 0 && Math.round(n.food) === 0);
    r.clock.now += 100 * HOUR;
    n = r.settle(ME);
    yes('S2 nothing goes below nothing', n.food === 0 && n.drink === 0 && n.rest === 0);
  }

  // S3: the bands.
  {
    const r = rig();
    yes('S3 half full is fine', r.bandOf(50) === 'fine' && r.bandOf(100) === 'fine');
    yes('S3 then weary, bad and spent',
        r.bandOf(49) === 'weary' && r.bandOf(24) === 'bad' && r.bandOf(9) === 'spent');
  }

  // S4: the penalties, and the one that is a multiplier.
  {
    const r = rig();
    const full = r.effects(ME, { food: 100, drink: 100, rest: 100 });
    yes('S4 a fed, watered, rested character pays nothing',
        Object.keys(full).length === 0);

    const starving = r.effects(ME, { food: 0, drink: 100, rest: 100 });
    yes('S4 hunger takes strength, not magic',
        starving.stamina < 0 && starving.magicka === undefined);
    const parched = r.effects(ME, { food: 100, drink: 0, rest: 100 });
    yes('S4 thirst takes magic and legs, not strength',
        parched.magicka < 0 && parched.speedMult < 0 && parched.stamina === undefined);
    const spent = r.effects(ME, { food: 100, drink: 100, rest: 0 });
    yes('S4 exhaustion takes a little of everything',
        spent.health < 0 && spent.stamina < 0 && spent.magicka < 0 && spent.speedMult < 0);

    const all = r.effects(ME, { food: 0, drink: 0, rest: 0 });
    yes('S4 three empty meters add up rather than overwrite',
        all.stamina < starving.stamina && all.magicka < parched.magicka);
    /*
      attackDamageMult is a MULTIPLIER on a base of 1. A -20 there is not a
      penalty, it is a character who deals no damage at all and then some. The
      perPoint note in the gamemode is about the same trap in the other
      direction, where a 5 was six times melee damage.
    */
    yes('S4 attackDamageMult stays a small fraction, because it multiplies',
        all.attackDamageMult < 0 && all.attackDamageMult > -1);
  }

  // S5: resting, and the bard on top of it.
  {
    const r = rig();
    r.seed(ME);
    /*
      FOUR HOURS, NOT TEN. Rest empties in eight hours at the rate Patrick
      asked for, so ten hours awake is a character who is flat on the floor
      and the check wanted a number still above zero. Four hours awake is
      half a night and is what this is actually about: it costs, and it has
      not bottomed out.
    */
    r.clock.now += 4 * HOUR;
    let n = r.settle(ME);
    const tired = n.rest;
    yes('S5 half a night awake costs rest', tired < 100 && tired > 0);

    r.resting(ME, 'bed');
    r.clock.now += 1 * HOUR;
    n = r.settle(ME);
    yes('S5 an hour in a bed is worth more than the hour cost', n.rest > tired);

    /*
      A bard in the same cell adds on top.

      THE CHARACTER HAS TO BE TIRED FIRST. The first version of this rested
      somebody who was already at 100 and compared two numbers that were both
      clamped there, so it could only ever say the bard did nothing. A check
      that cannot tell the two apart is not a check, which is the lesson the
      deposit harness already learned the expensive way.
    */
    /*
      MINUTE BY MINUTE, BECAUSE THAT IS WHAT THE SERVER DOES.

      The first version of this jumped a whole hour in one settle and then
      asked whether the bard had helped. It had not, and the code was right:
      settle samples "is a bard here" once and applies it to the whole elapsed
      span, and an hour is far longer than the few minutes a /bard lasts, so
      the bard had been forgotten before the question was asked.

      The live tick runs every minute, so the real sampling error is a minute
      and not an hour. Ticking the way the server ticks is both the honest test
      and the one that measures what people will feel. Worth keeping: a test
      that fast forwards past the thing it is testing will report the feature
      missing and be believed.
    */
    const BARD = 0xff000002;
    const MIN = 60000;
    function restedOverMinutes(withBard, minutes) {
      const rr = rig();
      rr.seed(ME);
      rr.cellOf(ME, 'inn:X.esm');
      rr.clock.now += 18 * HOUR;      // properly tired, and nowhere near the cap
      rr.settle(ME);
      if (withBard) {
        rr.seed(BARD);
        rr.cellOf(BARD, withBard === 'here' ? 'inn:X.esm' : 'somewhere:else.esm');
        rr.bard(BARD);
      }
      rr.resting(ME, 'inn');
      const from = rr.settle(ME).rest;
      for (let i = 0; i < minutes; i++) { rr.clock.now += MIN; rr.settle(ME); }
      return rr.settle(ME).rest - from;
    }
    const alone = restedOverMinutes(null, 4);
    yes('S5 four minutes resting is worth something to start with', alone > 0);
    yes('S5 a bard in the room makes the rest better',
        restedOverMinutes('here', 4) > alone);
    yes('S5 and a bard in another hold does not',
        Math.abs(restedOverMinutes('away', 4) - alone) < 1e-9);
  }

  // S6: a bed is the best rest, and the order is the pitch's.
  {
    const r = rig();
    const rec = r.NEEDS.recover;
    yes('S6 a bed beats an inn beats a campfire beats a chair',
        rec.bed > rec.inn && rec.inn > rec.campfire && rec.campfire > rec.sit);
  }

  // S7: logging out in a bed. The first settle after somebody comes back
  // into the world is their arrival, and that is where the night counts
  // (#1606; tests/test-1606-logout-fill.js has the rest of it).
  {
    const r = rig();
    r.seed(ME);
    r.clock.now += 15 * HOUR;
    r.settle(ME);
    r.resting(ME, 'bed');
    // Logged out, and away for a night.
    r.leave(ME);
    r.clock.now += 9 * HOUR;
    r.back(ME);
    const n = r.settle(ME);
    yes('S7 sleeping in a bed and logging out means coming back rested',
        n.rest === 100 && r.said.some(function (l) { return /slept well/.test(l); }));
    yes('S7 and it is not still resting when they get up', n.resting === '');

    // Somebody who logged out standing in a field does not.
    const r2 = rig();
    r2.seed(ME);
    r2.clock.now += 15 * HOUR;
    r2.settle(ME);
    r2.leave(ME);
    r2.clock.now += 9 * HOUR;
    r2.back(ME);
    yes('S7 but logging out on your feet does not', r2.settle(ME).rest < 100);
  }

  // S8: ale, which is the one drink that costs something.
  {
    const r = rig();
    r.seed(ME);
    r.clock.now += 2 * HOUR;
    let n = r.settle(ME);
    const drinkWas = n.drink, restWas = n.rest;
    r.ate(ME, 'ale');
    n = r.settle(ME);
    yes('S8 ale fills thirst faster than water', r.NEEDS.ale.drink > r.NEEDS.drink.def);
    yes('S8 and takes rest off you for it', n.rest < restWas && n.drink > drinkWas);
  }

  // S9: working costs rest, and rank pays it back.
  {
    /*
      A COST PER SWING, NOT A RATE. This used to check workRest, a multiplier
      on the drain for the two minutes after each job, and Patrick measured
      what that is worth: "I didn't get anymore tired while mining or
      smithing". Four tenths of a point for a whole spell of mining. The
      multiplier is 1 across the board now and the work itself costs, which
      is what these hold.
    */
    const r = rig();
    const w = r.NEEDS.work;
    yes('S9 a swing of work costs rest', w.novice > 0);
    yes('S9 and every rank costs less than the one below it',
        w.novice > w.advanced && w.advanced > w.expert && w.expert > w.master);
    yes('S9 a master still pays something', w.master > 0);
    yes('S9 and the old multiplier is not charging for the same swing as well',
        r.NEEDS.workRest.novice === 1);

    // And it is felt: twenty swings is a third of the meter for a novice.
    const r2 = rig();
    r2.seed(ME);
    const before = r2.settle(ME).rest;
    for (let i = 0; i < 20; i++) { r2.worked(ME); }
    const after = r2.settle(ME).rest;
    yes('S9 twenty swings is something anybody would notice',
        (before - after) > 20 && (before - after) < 45);
  }

  // S10: nothing here can kill anybody.
  {
    /*
      Nothing in here can end a session.

      The words are named exactly rather than searched for loosely: the first
      version of this looked for 'kill' anywhere in the block and failed on
      Blade's own sentence, "when doing your skilled profession". A check that
      fails on the word SKILLED is worse than no check, because the next person
      reads a red line and learns to ignore it.
    */
    yes('S10 nothing in the block can kill, damage or respawn anybody',
        block.indexOf('onDeath') === -1 &&
        block.indexOf('damageActorValue') === -1 &&
        block.indexOf('mp.respawn') === -1 &&
        block.indexOf('.kill(') === -1 &&
        block.indexOf('setDead') === -1);
    yes('S10 and every actor value it names is one perPoint already proves',
        ['health', 'stamina', 'magicka', 'speedMult', 'attackDamageMult', 'magickaRateMult']
          .every(function (n) { return src.indexOf(n + ':') !== -1; }));
  }

  // S11: too tired to craft is a gate, with a number behind it.
  {
    const r = rig();
    r.seed(ME);
    yes('S11 a rested character can craft', r.tooTiredToCraft(ME) === false);
    r.clock.now += 100 * HOUR;
    yes('S11 an exhausted one cannot', r.tooTiredToCraft(ME) === true);
  }

  // S12: what it says, and when.
  {
    const r = rig();
    r.seed(ME);
    r.clock.now += 2 * HOUR;
    r.settle(ME);
    const quiet = r.said.length;
    r.clock.now += 1 * HOUR;
    r.settle(ME);
    yes('S12 settling says nothing by itself', r.said.length === quiet);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
