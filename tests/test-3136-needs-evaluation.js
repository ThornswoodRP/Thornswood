// test-3136-needs-evaluation.js
//
//     node tests/test-3136-needs-evaluation.js
//
// #3136 asked for hunger, thirst, rest, temperature, the weather, the season
// and drunk and high to be checked end to end. The checks that already
// existed held (test-needs.js, test-1377-season.js, the test-1382-* family,
// test-1606, test-1734, test-1764, test-2246, test-hud.js, test-temp.js).
// Reading the code around them found three causes, and this is the check for
// each:
//
//   E  A meal was a line anybody could type. The meters moved on the front
//      plugin's /ate line, and /ate with a food's id in the chat was a meal
//      with no food. The engine raises mp.onEatItem once it has checked the
//      pack holds the thing (MpActor::OnEquip), so the needs block hears it
//      there now (eaten) and /ate is gone from the server, the plugin and the
//      voice service's list of plugin reports.
//   S  The tick moved somebody to the sky's new roll before settling them, so
//      the stretch since the last settle was charged at the new place, and a
//      roll that took the rain away dried them at once, with none of the 3
//      minutes of wet. It settles first now, then moves them through the one
//      function place() moves them through (moveTo).
//   H  Lying down drunk and coming back inside 24 minutes was a hangover.
//      Since #3153 nothing about logging out starts one: being drunk wearing
//      off does, when the 45 minutes pass, and a night in a bed sleeps it off.
//
// Drives the real needs block out of game/gamemode.js over a fake mp and a
// fake clock, and the real onEatItem handler out of the injury block.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const read = (...p) => fs.readFileSync(path.join(REPO_DIR, ...p), 'utf8').split(CR).join('');

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

const ALE = 0x34c5e;      // ale, by the food table below
const BREAD = 0x65c97;    // an ALCH the food table does not know: a meal of 15
const ROOT = 0x6bc07;     // an INGR
const BREWED = 0xff000123;

function rig() {
  const store = {};
  const online = [];
  const clock = { now: 1000000000000 };
  const said = [];
  const g = {};
  const types = {};
  types[ALE] = 'ALCH'; types[BREAD] = 'ALCH'; types[ROOT] = 'INGR';
  const Fake = {
    makeProperty: function () { },
    getDescFromId: function () { return ''; },
    lookupEspmRecordById: function (id) {
      return types[id] ? { record: { type: types[id] } } : { record: null };
    },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (key === 'worldOrCellDesc') { return 'cell:X.esm'; }
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
    'var FOODS = { items: { "34c5e:Skyrim.esm": { k: "ale" } } }; function idOf(d) { return parseInt(d, 16); }\n' +
    block + '\nreturn globalThis.__thornswoodNeeds;');
  const api = fn(
    g, Fake, FakeDate, { log: function () { } },
    function () { return 0; }, function () { },
    function (n, f) { return f; },
    function (id, line) { said.push(line); },
    function (id, line) { said.push(line); },
    Math, Number, String, Object, isFinite);
  api.g = g;
  api.clock = clock;
  api.said = said;
  api.online = online;
  api.stored = function (id) { return store[id] ? store[id].v : undefined; };
  api.put = function (id, n) { Fake.set(id, 'x', n); };
  api.seed = function (id) { Fake.set(id, 'x', api.fresh()); };
  g.__thornswoodHurt = { exposed: function () { return false; }, careChanged: function () { } };
  return api;
}

let smoke = null;
if (block !== null) {
  try { smoke = rig(); } catch (e) { console.log('  (' + e.message + ')'); block = null; }
}
yes('the needs block is in the gamemode and runs', block !== null && !!smoke);

const MIN = 60000;
const ME = 0xff000001;
const NPC = 0x0001a2b3;

function someone() {
  const r = rig();
  r.online.push(ME);
  r.seed(ME);
  r.settle(ME);
  return r;
}

// What a swallow is, on a block from before eaten: the old consumed, so the
// S and H checks still say what they measure there.
function swallow(r, id, base) { return r.eaten ? r.eaten(id, base) : r.consumed(id, base); }

if (block !== null && smoke) {
  // ---------------------------------------------- E: a meal is the item
  yes('E0 the needs block hears a swallow through eaten', typeof smoke.eaten === 'function');
  if (typeof smoke.eaten === 'function') {
    const r = someone();
    const n = r.read(ME); n.food = 50; n.drink = 50; r.put(ME, n);
    r.eaten(ME, BREAD);
    yes('E1 an ALCH the engine saw go down is a meal: 15 hunger', Math.round(r.read(ME).food) === 65);
    r.clock.now += 10000;
    r.eaten(ME, ALE);
    yes('E1 and an ale is the ale: 30 thirst on the first', Math.round(r.read(ME).drink) === 80);
    r.clock.now += 10000;
    r.eaten(ME, BREWED);
    yes('E2 a brewed potion, above the runtime line, is the sip of 5', Math.round(r.read(ME).drink) === 85);
    const before = JSON.stringify(r.read(ME));
    r.clock.now += 10000;
    r.settle(ME);
    const settled = JSON.stringify(r.read(ME));
    r.eaten(ME, ROOT);
    yes('E3 an ingredient (INGR) is not a meal: nothing moves',
        JSON.stringify(r.read(ME)) === settled && before !== '');
    r.eaten(ME, 0x9999);
    yes('E3 nor a record the engine has no type for', JSON.stringify(r.read(ME)) === settled);
  }
  if (typeof smoke.eaten === 'function') {
    const r = someone();
    r.eaten(NPC, BREAD);
    yes('E4 a swallow by somebody who is not a person online writes no meters', r.stored(NPC) === undefined);
  }

  // The real handler hands every swallow to eaten, and says its line.
  {
    const at = src.indexOf("  mp.onEatItem = guard('onEatItem', function (actorId, baseId) {");
    const end = at < 0 ? -1 : src.indexOf('\n  });', at);
    const handler = (at >= 0 && end >= 0) ? src.slice(at, end + '\n  });'.length) : '';
    const calls = [], lines = [];
    const g = {
      __thornswoodNeeds: {
        effectScale: function () { return 1; },
        eaten: function (id, base) { calls.push([id, base]); return 'You have eaten enough.'; }
      }
    };
    const mp = {};
    let ran = false;
    try {
      new Function('g', 'mp', 'guard', 'tell', 'swallowed', 'hlog', 'say',
        handler + '\nreturn mp.onEatItem;')(
        g, mp, function (n, f) { return f; }, function () { }, function () { return ''; },
        function () { }, function (id, line) { lines.push([id, line]); })(ME, BREAD);
      ran = true;
    } catch (e) { console.log('  (' + e.message + ')'); }
    yes('E5 mp.onEatItem hands the swallow to the needs block\'s eaten',
        ran && calls.length === 1 && calls[0][0] === ME && calls[0][1] === BREAD);
    yes('E5 and says its line in the chat', lines.length === 1 && lines[0][1] === 'You have eaten enough.');
  }

  // Nothing typed or sent by the client feeds anybody.
  {
    const words = src.slice(src.indexOf('const WORDS = ['), src.indexOf('];', src.indexOf('const WORDS = [')));
    yes('E6 /ate is not a word the server answers', words.indexOf("'/ate'") === -1 && src.indexOf("word === '/ate'") === -1);
    yes('E6 the front plugin sends no /ate', read('game', 'plugins', 'thornswood-front.js').indexOf("'/ate '") === -1);
    yes('E6 and the voice service keeps no /ate shape among the plugin reports',
        read('voice', 'voice-server.js').indexOf('\\/ate ') === -1);
  }

  // ------------------------------------------- S: the sky rolls after the settle
  // A season block whose sky keeps whatever the client said.
  function withSky(r) {
    r.g.__thornswoodSeason = {
      outdoorShift: function () { return 0; },
      skyAdjust: function (id, n) { return { place: n.place, sky: n.sky }; }
    };
  }
  {
    // Two of the same person in the rain at 34, the rain's own target. In
    // one the sky stays; in the other it rolls clear at the next tick.
    const stays = someone(), rolls = someone();
    [stays, rolls].forEach(function (r) {
      withSky(r);
      r.place(ME, 'rain', 'aa', '0', '0', '0', '-');
      const n = r.read(ME); n.temp = 34; r.put(ME, n);
      r.settle(ME);
    });
    rolls.g.__thornswoodSeason.skyAdjust = function () { return { place: 'outdoors', sky: 'bb' }; };
    stays.clock.now += 20000; rolls.clock.now += 20000;
    stays.tick(); rolls.tick();
    const t1 = stays.read(ME).temp, t2 = rolls.read(ME).temp;
    yes('S1 the 20 seconds before the roll are charged at the rain they were spent in (' +
        t1.toFixed(3) + ' and ' + t2.toFixed(3) + ')', Math.abs(t1 - t2) < 1e-9 && Math.abs(t1 - 34) < 1e-9);
    const n = rolls.read(ME);
    yes('S2 the roll moves them to the clear sky', n.place === 'outdoors' && n.sky === 'bb');
    yes('S2 and starts the 3 minutes of wet from the rain\'s 34', n.wetFrom === rolls.clock.now && n.wetPlace === 34);
    rolls.clock.now += 90000;
    const mid = rolls.view(ME).tempTarget;
    yes('S3 halfway through the 3 minutes the target is between the rain and the open (' + mid + ')',
        mid > 34 && mid < 40);
    rolls.clock.now += 120000;
    yes('S3 and after them it is the open sky\'s 40', rolls.view(ME).tempTarget === 40);
  }

  // ----------------------------------------- H: a bed is a bed, night or not
  function drunkThenAway(kind, minutes) {
    const r = someone();
    swallow(r, ME, ALE); r.clock.now += 9000;
    swallow(r, ME, ALE); r.clock.now += 9000;
    swallow(r, ME, ALE);
    const n = r.read(ME); n.resting = kind; r.put(ME, n);
    r.online.length = 0; r.tick();
    r.clock.now += minutes * MIN;
    r.online.push(ME);
    r.settle(ME);
    return r;
  }
  // Since #3153 a hangover is what being drunk leaves when the 45 minutes
  // pass, in the world or while away; a night in a bed sleeps it off.
  {
    const r = drunkThenAway('bed', 10);
    yes('H1 three ales, lying in your own bed, back in 10 minutes: no hangover', r.hungOver(ME) === false);
    yes('H1 and still drunk, the ales still counting', r.read(ME).drunk === true && r.read(ME).ale === 3);
    r.clock.now += 40 * MIN;
    r.settle(ME);
    yes('H1 sober once the 45 minutes pass, and hung over from then (#3153)',
        r.read(ME).drunk === false && r.hungOver(ME) === true);
  }
  {
    const r = drunkThenAway('rough', 10);
    yes('H2 a bedroll on the road counts as a bed: no hangover, still drunk', r.hungOver(ME) === false && r.read(ME).drunk === true);
  }
  {
    const r = drunkThenAway('common', 30);
    yes('H3 an inn bed and a night: slept it off, sober and no hangover',
        r.hungOver(ME) === false && r.read(ME).drunk === false && r.read(ME).ale === 0);
  }
  {
    const r = drunkThenAway('sit', 10);
    yes('H4 a seat gives no night: back in 10 minutes, still drunk and not yet hung over',
        r.hungOver(ME) === false && r.read(ME).drunk === true);
  }
  {
    const r = drunkThenAway('', 60);
    yes('H5 on your feet, back after the 45 minutes: hung over, as drink.md says', r.hungOver(ME) === true);
  }
  {
    const page = read('docs', 'systems', 'drink.md');
    yes('H6 drink.md says a bed logout before a night is still drunk, not a hangover',
        /before a night/.test(page) && /still drunk/.test(page));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
