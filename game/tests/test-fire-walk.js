// test-fire-walk.js
//
// Walking into a new cell must not throw out of the place tick.
//
// WHAT WAS MEASURED. The dev client's front log for 23 September,
// C:\Thornswood-DevBuild\Game\Data\Platform\thornswood-front.log, has 80 lines
// of
//
//     place threw: ReferenceError: walked is not defined
//
// between 20:08 and 21:00, and not one "fires: N of ours in this cell" line.
// #184 moved the fire probe off Game.findClosestReferenceOfType and onto a
// walk of the cell, and the line fireSpotsHere logs at the end of that walk
// named `walked`, which was the counter inside the walk. Its own is
// fireWalked. So every cell change threw after the fires had been kept, the
// place tick died before it composed its line, and the /place report for that
// tick never reached the server. The tick after it read the kept list and got
// through, which is why nothing looked broken from the outside.
//
// test-temp.js reads this code as text, and text that names a variable which
// does not exist reads exactly as well as text that names one that does. So
// this RUNS it: the real CELL_TYPES, walkCellSlice, the fire state, fireIdList,
// fireSpotsHere and fireDistance, lifted out of the plugin, over a fake cell
// and a fake sp. The fire table is a stub of two real Skyrim.esm bases, because
// the table is data and the walk is what is under test.
//
// THE CLOCK IS THE HARNESS'S (#2581). The walk stops once FIRE_SLICE_MS (2 ms)
// has gone by performance.now, which is right in the game, where the slice is
// a frame's budget. Run on the real clock here, a busy machine spent the 2 ms
// before the walk had read the fake cell's four references, and S1 read a walk
// that had not finished: 11 passed 8 failed one run, 19 passed the next. So
// the lifted code is handed a performance of the harness's own, whose time
// moves only when the harness moves it. S1 to S4 test the walk on a clock that
// stands still; S5 moves it a millisecond for each reference read and checks
// that the slice does stop once its time is spent, and that the walk finishes
// over the next slices with the same answer.
//
// NO CLOCK DECIDES A WALK (#2590). Two timers sat around this walk: an empty
// cell was walked again every 8 s, and bases that resolved to nothing were
// asked for again every 4 s, over a load race nobody had measured. A cell is
// now walked again only when the engine says the cell underfoot has finished
// loading (cellFullyLoaded, fireCellLoaded), and the bases are resolved once.
// The lifted code gets the harness's clock for Date.now as well, and S7 to
// S10 move it by hours between asks: a walk or an ask on a clock shows up.
// Against the plugin with the two timers, S7, S8 and S10 fail.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT ||
            path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// From `from` to the end of the named function. The end is the first closing
// brace at the plugin's own indent after the function starts, and everything
// inside a function is indented further than that.
function lift(from, fnName) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const f = src.indexOf('function ' + fnName + '(', a);
  if (f < 0) { return null; }
  const END = '\n  }\n';
  const b = src.indexOf(END, f);
  return b < 0 ? null : src.slice(a, b + END.length);
}

const walk = lift('  const CELL_TYPES = [', 'walkCellSlice');
const fires = lift('  let fireBases = 0;', 'fireDistance');
const reach = /const FIRE_REACH = (\d+);/.exec(src);
const inside = /const FIRE_INSIDE = (\d+);/.exec(src);
yes('the cell walk is in the plugin', walk !== null);
yes('the fire probe is in the plugin', fires !== null);
yes('the fire reach is in the plugin', !!reach && !!inside);

const FXFIRE01 = 0x13b40;
const EMBERS_HEAVY = 0x33da4;
const NOT_A_FIRE = 0x999;

// The time the lifted code reads, in milliseconds. It starts well above zero,
// as performance.now does in a game that has been running, and moves only
// when a test moves it.
function standingClock() {
  const c = { t: 1000 };
  c.performance = { now: function () { return c.t; } };
  // Date.now too, the same clock, so a wait on the wall clock in the lifted
  // code moves when the harness moves time and S7 to S10 would see it.
  c.Date = { now: function () { return c.t; } };
  return c;
}

function harness(clock) {
  const logs = [];
  const log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  const time = clock || standingClock();
  const sp = {
    Game: {
      getFormEx: function (id) { return { id: id }; },
      getFormFromFile: function (id) { return { id: id }; }
    },
    Form: {
      from: function (raw) {
        return raw ? { getFormID: function () { return raw.id; } } : null;
      }
    }
  };
  const fn = new Function('sp', 'log', 'FIRE_BASES', 'FIRE_FILES',
    'FIRE_REACH', 'FIRE_INSIDE', 'performance', 'Date', 'PLACED_WATERS', 'WADE_DEEP', walk + fires +
    '\nreturn {' +
    '  spots: fireSpotsHere,' +
    '  distance: fireDistance,' +
    '  loaded: typeof fireCellLoaded === "function" ? fireCellLoaded : function () { },' +
    '  walked: function () { return fireWalked; },' +
    '  hits: function () { return fireHits; },' +
    '  threw: function () { return fireThrew; },' +
    '  bases: function () { return fireBases; },' +
    '  precise: SLICE_PRECISE,' +
    '  sliceMs: FIRE_SLICE_MS' +
    '};');
  const api = fn(sp, log,
    [['Skyrim.esm', FXFIRE01], ['Skyrim.esm', EMBERS_HEAVY]], ['Skyrim.esm'],
    Number(reach[1]), Number(inside[1]), time.performance, time.Date, [], 70);
  api.logs = logs;
  api.clock = time;
  api.sp = sp;
  return api;
}

function ref(base, x, y, z, off) {
  return {
    getBaseObject: function () { return { getFormID: function () { return base; } }; },
    getPositionX: function () { return x; },
    getPositionY: function () { return y; },
    getPositionZ: function () { return z; },
    isDisabled: function () { return !!off; }
  };
}

// A cell whose references are listed by form type. 'throw' makes asking for
// that type throw, the way a native call does on a bad cell.
// onRead, when given, runs at each reference read: S5 moves the clock there.
function cell(id, byType, calls, onRead) {
  return {
    getFormID: function () { return id; },
    getNumRefs: function (t) {
      calls.n++;
      if (byType[t] === 'throw') { throw new Error('no count for type ' + t); }
      return (byType[t] || []).length;
    },
    getNthRef: function (i, t) { if (onRead) { onRead(); } return byType[t][i]; }
  };
}

function standingIn(c) {
  return { getParentCell: function () { return c; } };
}

function tryIt(f) {
  try { return { value: f(), err: null }; }
  catch (e) { return { value: null, err: String((e && e.message) || e) }; }
}

if (walk !== null && fires !== null && reach && inside) {
  // S1: THE BUG. A cell nobody has been in yet, asked the way the place tick
  // asks, through fireDistance.
  {
    const h = harness();
    const calls = { n: 0 };
    const inn = cell(0x1605e, {
      24: [ref(FXFIRE01, 100, 0, 0), ref(NOT_A_FIRE, 0, 0, 0),
           ref(EMBERS_HEAVY, 10, 0, 0, true)],
      34: [ref(EMBERS_HEAVY, 1000, 0, 0)],
      36: 'throw',
      42: []
    }, calls);
    const me = standingIn(inn);

    const first = tryIt(function () { return h.distance(50, 0, 0, me); });
    yes('S1 walking into a new cell does not throw out of the place tick' +
        (first.err ? ' (it threw: ' + first.err + ')' : ''), first.err === null);
    yes('S1 the nearest lit fire is 50 away', first.value === 50);

    const spots = tryIt(function () { return h.spots(me); });
    yes('S1 it keeps the two lit fires of ours and nothing else',
        spots.err === null && spots.value.length === 2 &&
        spots.value[0][0] === 100 && spots.value[1][0] === 1000);
    yes('S1 the heartbeat counter says four things were looked at',
        h.walked() === 4);
    yes('S1 the log line says the same four',
        h.logs.indexOf('fires: 2 of ours in this cell, out of 4 thing(s) looked at') >= 0);
    yes('S1 the form type that threw is counted, not fatal', h.threw() === 1);
    yes('S1 both bases resolved', h.bases() === 2 && h.hits() === 2);

    // S2: the same cell again is the kept list, not a second walk.
    const asked = calls.n;
    const lines = h.logs.length;
    const again = tryIt(function () { return h.distance(1000, 0, 0, me); });
    yes('S2 the same cell is not walked twice', calls.n === asked);
    yes('S2 and says nothing new', h.logs.length === lines);
    yes('S2 standing at the far fire finds it', again.err === null && again.value === 0);

    // S3: the next cell is walked, and it is the one that used to throw
    // every time, because every cell change reached that line.
    const calls2 = { n: 0 };
    const yard = cell(0x9a7b, { 24: [ref(FXFIRE01, 0, 0, 0)] }, calls2);
    const next = tryIt(function () { return h.distance(400, 0, 0, standingIn(yard)); });
    yes('S3 the next cell does not throw either' +
        (next.err ? ' (it threw: ' + next.err + ')' : ''), next.err === null);
    yes('S3 and it was walked', calls2.n === 4);
    yes('S3 a fire past reach is no fire', next.value === -1);
    yes('S3 the counter moved to the new cell', h.walked() === 1);
    yes('S3 and the line says so',
        h.logs.indexOf('fires: 1 of ours in this cell, out of 1 thing(s) looked at') >= 0);
  }

  // S4: nowhere at all, which is the loading screen.
  {
    const h = harness();
    const r = tryIt(function () { return h.distance(0, 0, 0, standingIn(null)); });
    yes('S4 no cell is no fire and no throw', r.err === null && r.value === -1);
  }

  // S5: THE SLICE STOPS. Each reference read takes a millisecond of the
  // harness's clock, so a slice has time for FIRE_SLICE_MS of them. Five fires
  // take three slices, two, two and one, and a walk that ignored its slice
  // would read all five in the first.
  {
    const h = harness();
    yes('S5 the walk measures its slice on the clock the harness hands it',
        h.precise === true && h.sliceMs === 2);
    const fires5 = [];
    for (let k = 0; k < 5; k++) { fires5.push(ref(FXFIRE01, 100 * (k + 1), 0, 0)); }
    const calls = { n: 0 };
    const hall = cell(0x2a6f1, { 24: fires5 }, calls, function () { h.clock.t += 1; });
    const me = standingIn(hall);

    const first = tryIt(function () { return h.distance(100, 0, 0, me); });
    yes('S5 the first slice stops once its time is spent: ' + h.walked() + ' of 5 read, ' +
        h.sliceMs + ' fit', first.err === null && h.walked() === h.sliceMs);
    yes('S5 and a walk not finished is no fire yet, with nothing logged about it',
        first.value === -1 && h.logs.every(function (l) { return l.indexOf('in this cell') < 0; }));

    const read = [h.walked()];
    let last = first;
    while (last.err === null && last.value === -1 && read.length < 20) {
      last = tryIt(function () { return h.distance(100, 0, 0, me); });
      read.push(h.walked());
    }
    yes('S5 the next slices carry it on where it stopped, read so far after each: ' + read.join(', '),
        last.err === null && read.join(',') === '2,4,5');
    yes('S5 and it ends with every fire, each read once',
        last.value === 0 && h.walked() === 5 && h.hits() === 5 &&
        h.logs.indexOf('fires: 5 of ours in this cell, out of 5 thing(s) looked at') >= 0);
  }

  // S6: ONE SLICE FOR BOTH. Resolving the bases comes out of the same slice
  // as the walk. When asking for a base takes 3 ms, the first slice resolves
  // one base and stops, the second resolves the other and leaves the walk
  // nothing, and the walk starts in the third.
  {
    const h = harness();
    const ask = function (id) { h.clock.t += 3; return { id: id }; };
    // The lifted code holds the sp it was made with, so the stub is swapped
    // on that object.
    const calls = { n: 0 };
    const yard = cell(0x9a7c, { 24: [ref(EMBERS_HEAVY, 30, 0, 0)] }, calls);
    const me = standingIn(yard);
    h.sp.Game.getFormEx = ask;
    tryIt(function () { return h.distance(0, 0, 0, me); });
    yes('S6 a slice spent on one base resolves no more', h.bases() === 0 && calls.n === 0);
    tryIt(function () { return h.distance(0, 0, 0, me); });
    yes('S6 the slice that resolves the last base leaves the walk nothing', h.bases() === 2 && calls.n === 0);
    const third = tryIt(function () { return h.distance(0, 0, 0, me); });
    yes('S6 the walk has the next slice to itself', third.err === null && third.value === 30 && calls.n === 4);
  }

  // S7 to S10, #2590: a cell is walked again when the engine says it has
  // finished loading (cellFullyLoaded), and never on a clock. The clock here
  // is moved by hours between asks: nothing may depend on it.

  // S7: AN EMPTY WALK STANDS until the cell says it has loaded. The room
  // gets its fire after the first walk, the way a cell still loading does.
  {
    const h = harness();
    const calls = { n: 0 };
    const refs = { 24: [ref(NOT_A_FIRE, 0, 0, 0)] };
    const forge = cell(0x16bdf, refs, calls);
    const me = standingIn(forge);
    const first = tryIt(function () { return h.distance(0, 0, 0, me); });
    yes('S7 a room with no fire of ours yet is no fire', first.err === null && first.value === -1);
    const asked = calls.n;
    refs[24].push(ref(FXFIRE01, 20, 0, 0));
    let later = null;
    for (let k = 0; k < 5; k++) {
      h.clock.t += 3600 * 1000;
      later = tryIt(function () { return h.distance(0, 0, 0, me); });
    }
    yes('S7 the empty list stands however long it is asked, no walk on a clock',
        later.err === null && later.value === -1 && calls.n === asked);
    const ev = tryIt(function () { return h.loaded({ cell: forge }); });
    yes('S7 the cell finishing loading does not throw', ev.err === null);
    yes('S7 and says what the walk before it had seen',
        h.logs.indexOf('fires: cell 16bdf finished loading after it was walked (0 of ours, out of 1 thing(s) looked at), so it is walked again') >= 0);
    const after = tryIt(function () { return h.distance(0, 0, 0, me); });
    yes('S7 the walk after it finds the fire', after.err === null && after.value === 20 &&
        h.logs.indexOf('fires: 1 of ours in this cell, out of 2 thing(s) looked at') >= 0);
    const n2 = calls.n;
    h.clock.t += 3600 * 1000;
    tryIt(function () { return h.distance(0, 0, 0, me); });
    yes('S7 and that list is kept, no third walk', calls.n === n2);
  }

  // S8: A FULL LIST FROM A WALK RUN TOO SOON is redone as well, which the
  // retry never did; and while the second walk runs, the first list answers.
  {
    const h = harness();
    const calls = { n: 0 };
    const refs = { 24: [ref(FXFIRE01, 500, 0, 0)] };
    const yard = cell(0x1a275, refs, calls);
    const me = standingIn(yard);
    yes('S8 the first walk finds the far fire', h.distance(400, 0, 0, me) === 100);
    refs[24].push(ref(EMBERS_HEAVY, 10, 0, 0));
    yes('S8 the fire that came in late is not seen before the cell says it is in',
        h.distance(0, 0, 0, me) === -1);
    h.loaded({ cell: yard });
    // Each read now costs the slice, so the second walk takes more than one ask.
    const slow = cell(0x1a275, refs, calls, function () { h.clock.t += 1; });
    const meSlow = standingIn(slow);
    const mid = h.distance(450, 0, 0, meSlow);
    yes('S8 mid way through the second walk, the first list still answers', mid === 50 && h.hits() === 1);
    let d = mid;
    for (let k = 0; k < 5 && h.hits() !== 2; k++) { d = h.distance(0, 0, 0, meSlow); }
    yes('S8 the second walk keeps both', h.hits() === 2 && d === 10);
  }

  // S9: ONLY THE CELL UNDERFOOT. Cells load around somebody all the time.
  {
    const h = harness();
    const calls = { n: 0 };
    const here = cell(0x42247, { 24: [ref(FXFIRE01, 30, 0, 0)] }, calls);
    const there = cell(0x42249, { 24: [] }, { n: 0 });
    const me = standingIn(here);
    h.distance(0, 0, 0, me);
    const asked = calls.n;
    const lines = h.logs.length;
    h.loaded({ cell: there });
    h.loaded({});
    h.loaded(null);
    h.distance(0, 0, 0, me);
    yes('S9 another cell loading, or an event with no cell, walks nothing and says nothing',
        calls.n === asked && h.logs.length === lines);
  }

  // S10: NO BASE RESOLVES. One pass, said once, never asked again.
  {
    const h = harness();
    let asks = 0;
    h.sp.Game.getFormEx = function () { asks++; return null; };
    const calls = { n: 0 };
    const yard = cell(0x9a7d, { 24: [ref(FXFIRE01, 0, 0, 0)] }, calls);
    const me = standingIn(yard);
    const r = tryIt(function () { return h.distance(0, 0, 0, me); });
    yes('S10 nothing resolved is no fire, no throw', r.err === null && r.value === -1);
    yes('S10 and says so once', h.logs.indexOf('fires: 0 of 2 bases resolved, across 1 plugin(s), so no fire warms or burns anybody this session') >= 0);
    const once = asks;
    for (let k = 0; k < 3; k++) {
      h.clock.t += 3600 * 1000;
      h.distance(0, 0, 0, standingIn(cell(0x9a7e + k, { 24: [] }, calls)));
    }
    yes('S10 the bases are not asked for again in later cells', asks === once && once === 2);
    yes('S10 and no cell is walked for nothing', calls.n === 0);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
