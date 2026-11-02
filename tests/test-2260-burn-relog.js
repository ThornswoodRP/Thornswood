// test-2260-burn-relog.js
//
//     node .\tests\test-2260-burn-relog.js
//
// Issue #2260: "Relogging removes the Bad Burn status, so it can be dodged by
// logging out." The burn was written only when the client said /burn 0, so a
// fire still alight at logout, or a client that went quiet, left no burn. The
// injury block runs here on its own over one fake mp and one fake clock, the
// way test-1383-injury.js runs it, and a fire that is never put out must
// still leave its bad burn: settled by the hurt tick, and by the next fire.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const a = src.indexOf('// ==== thornswood injury and disease ====');
const b = src.indexOf('// ==== end thornswood injury and disease ====');
const HURT_SRC = (a >= 0 && b > a) ? src.slice(a, b) : null;
yes('the injury block is in the gamemode', !!HURT_SRC);
const benchLine = /^const BENCH_BY_BASE = (\{.*\});$/m.exec(src);
const BENCH_BY_BASE = benchLine ? JSON.parse(benchLine[1]) : {};

function rig() {
  const G = {};
  const props = {};
  const clock = { now: 1700000000000 };
  const timers = [];
  const mp = {
    makeProperty: function () { },
    getDescFromId: function (id) { return 'ff' + id.toString(16) + ':Runtime'; },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return []; }
      if (key === 'profileId') { return id; }
      if (key === 'inventory') { return { entries: [] }; }
      if (key === 'equipment') { return { inv: { entries: [] } }; }
      if (key === 'pos') { return [0, 0, 0]; }
      if (key === 'worldOrCellDesc') { return '3c:Skyrim.esm'; }
      return props[id] ? props[id][key] : undefined;
    },
    set: function (id, key, v) { if (!props[id]) { props[id] = {}; } props[id][key] = JSON.parse(JSON.stringify(v)); },
    callPapyrusFunction: function () { }
  };
  const D = { now: function () { return clock.now; } };
  const M = Object.create(Math);
  M.random = function () { return 0.999; };
  new Function('globalThis,mp,Date,console,setInterval,clearInterval,guard,notify,say,Math,idOf,BENCH_BY_BASE', HURT_SRC)(
    G, mp, D, { log: function () { } },
    function (f, ms) { timers.push({ f: f, ms: ms }); return 0; }, function () { },
    function (n, f) { return f; }, function () { }, function () { }, M, function () { return 1; }, BENCH_BY_BASE);
  return { H: G.__thornswoodHurt, clock: clock, timers: timers };
}
function burnOf(r, id) {
  const ws = r.H.read(id).wounds.filter(function (w) { return w.k === 'burn'; });
  return ws.length ? ws[0] : null;
}

if (HURT_SRC) {
  // 1. Alight for ten seconds, then gone: no /burn 0 ever comes.
  let r = rig();
  const me = 0xff000101;
  r.H.burning(me, true);
  for (let s = 0; s < 10; s += 3) { r.clock.now += 3000; r.H.burning(me, true); }
  yes('while the fire still burns there is no burn yet', !burnOf(r, me));
  r.clock.now += 60000;
  // The hurt timer is the first setInterval the block makes.
  r.timers[0].f();
  const burn = burnOf(r, me);
  yes('logged out alight: the hurt tick writes the burn anyway', !!burn);
  yes('  and it is a bad burn, timed to the fire\'s last report', !!burn && burn.dealt >= r.H.HURT.burn.bad);
  yes('  and the record says Bad burn', r.H.lines(r.H.read(me), r.clock.now).indexOf('Bad burn') >= 0);

  // 2. A quiet fire, then a new fire after a long gap: the old one is a burn first.
  r = rig();
  r.H.burning(me, true);
  for (let s = 0; s < 10; s += 3) { r.clock.now += 3000; r.H.burning(me, true); }
  r.clock.now += 120000;
  r.H.burning(me, true);
  yes('a new fire after a quiet one settles the quiet one as a burn', !!burnOf(r, me));

  // 3. Unchanged: a short fire put out properly is not a bad burn, a long one is.
  r = rig();
  r.H.burning(me, true); r.clock.now += 3000; r.H.burning(me, true);
  yes('a short fire put out is still no bad burn', r.H.burning(me, false) === '' && !burnOf(r, me));
  r.H.burning(me, true);
  for (let s = 0; s < 10; s += 3) { r.clock.now += 3000; r.H.burning(me, true); }
  yes('a long fire put out is still a bad burn, and says so', /burnt you badly/.test(r.H.burning(me, false)) && !!burnOf(r, me));
  r.timers[0].f();
  yes('and the tick after it writes nothing twice', r.H.read(me).wounds.filter(function (w) { return w.k === 'burn'; }).length === 1);
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
