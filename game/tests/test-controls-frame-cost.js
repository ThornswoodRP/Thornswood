// test-controls-frame-cost.js
//
// The controls block must not call into the game on every update.
//
// MEASURED 26 September on DevBuild thornswood-front.log (~14:28-14:35 MT):
// controls was #1 in 11/13 heartbeats at 366-736 ms per ~30 s, after
// MENU_CACHE_MS and CONTROLS_CACHE_MS were already 250. The residual was
// getPlayer + notOurs (getPlayer again, isDead, getFurnitureReference) on
// every frame. The fix cached notOurs at CONTROLS_CACHE_MS.
//
// #2620 took the controls watchdog out, so nothing reads the eight flags on
// a frame any more: the five second input line reads them once each. This
// lifts the real CONTROLS table, notOurs and pulseControls out of the plugin
// and runs them on a fake clock and fake sp, and checks that no update
// handler is left reading the flags.
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

const START = '  const CONTROLS = [';
const END_MARK = '\n  }\n';
const a = src.indexOf(START);
const p = a < 0 ? -1 : src.indexOf('  function pulseControls() {', a);
const b = p < 0 ? -1 : src.indexOf(END_MARK, p);
const block = (a >= 0 && b >= 0) ? src.slice(a, b + END_MARK.length) : null;

yes('the plugin has its controls block, CONTROLS through pulseControls', block !== null);
yes('CONTROLS_CACHE_MS is 250', /const CONTROLS_CACHE_MS = 250;/.test(src));
yes('notOurs is cached at CONTROLS_CACHE_MS',
    /if \(now - notOursCachedAt < CONTROLS_CACHE_MS\) \{ return notOursCached; \}/.test(src));
yes('no update handler named controls is left (#2620)', src.indexOf("guard('controls'") < 0);
yes('the block registers no handler of its own', !!block && block.indexOf('sp.on(') < 0);
yes('the pulse is the one caller of pulseControls',
    (src.match(/pulseControls\(\)/g) || []).length === 2 &&
    src.indexOf('const controls = pulseControls();') > src.indexOf("guard('pulse'"));

function harness(opts) {
  opts = opts || {};
  const clock = { t: 1000 };
  const counts = { getPlayer: 0, isDead: 0, controlReads: 0, other: 0 };
  const flags = Object.assign({
    isMovementControlsEnabled: true,
    isFightingControlsEnabled: true,
    isCamSwitchControlsEnabled: true,
    isLookingControlsEnabled: true,
    isSneakingControlsEnabled: true,
    isMenuControlsEnabled: true,
    isActivateControlsEnabled: true,
    isJournalControlsEnabled: true
  }, opts.flags || {});
  const player = {
    isDead: function () { counts.isDead++; return !!opts.dead; },
    getFurnitureReference: function () { return null; },
    getSitState: function () { return 0; }
  };
  const sp = {
    Game: {
      getPlayer: function () { counts.getPlayer++; return player; },
      enablePlayerControls: function () { counts.other++; },
      setPlayerAIDriven: function () { counts.other++; }
    }
  };
  Object.keys(flags).forEach(function (k) {
    sp.Game[k] = function () { counts.controlReads++; return flags[k]; };
  });
  const FakeDate = { now: function () { return clock.t; } };
  const fn = new Function('sp', 'Date', 'var seatedInFurniture = false;\n' + block +
    '\nreturn { notOurs: notOurs, pulse: pulseControls, cacheMs: CONTROLS_CACHE_MS };');
  const api = fn(sp, FakeDate);
  api.clock = clock;
  api.counts = counts;
  return api;
}

if (block) {
  const h = harness();
  const line = h.pulse();
  yes('all on: the line says controls on (' + line + ')', line === ', controls on');
  yes('one line reads each of the eight flags once (got ' + h.counts.controlReads + ')', h.counts.controlReads === 8);
  yes('and switches nothing', h.counts.other === 0);

  const off = harness({ flags: { isFightingControlsEnabled: false, isCamSwitchControlsEnabled: false } });
  const offLine = off.pulse();
  yes('fighting and camera off are named in the table order (' + offLine + ')',
      offLine === ', controls off [fighting, camera]');
  yes('and still switches nothing back on', off.counts.other === 0);

  // Cache hit: two notOurs calls 16ms apart only ask the game once.
  const h2 = harness();
  h2.notOurs();
  const afterFirst = h2.counts.getPlayer;
  h2.clock.t = 1016;
  h2.notOurs();
  yes('notOurs cache: second call within 250ms does no getPlayer', h2.counts.getPlayer === afterFirst);
  h2.clock.t = 1300;
  h2.notOurs();
  yes('notOurs cache: call after 250ms refreshes', h2.counts.getPlayer === afterFirst + 1);

  // Thirty seconds of frames asking notOurs every frame: about four asks a second.
  const h3 = harness();
  for (let t = 1000; t <= 31000; t += 16) { h3.clock.t = t; h3.notOurs(); }
  const most = Math.floor(30000 / h3.cacheMs) + 2;
  yes('notOurs at 60 frames a second for 30 s: at most ' + most + ' isDead (got ' + h3.counts.isDead + ')',
      h3.counts.isDead <= most && h3.counts.isDead >= most - 8);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
