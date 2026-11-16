// test-2620-no-control-rescues.js
//
// Issue #2620. The front plugin had two pieces that switched every control
// back on, without knowing who had switched them off: the controls watchdog
// (five seconds off with no menu open) and the stuck rescue (forty keys in
// five seconds without moving). The tester logs from 24 September to
// 16 October showed the watchdog fighting the mining furniture, fixed at the
// root by #843, and the rescue never catching a real lock; nothing in this
// tree switches a control off or turns AI driven on. Both are gone.
//
// This checks:
//   - neither piece, nor its state, counters or log lines, is in the plugin
//   - nothing in game\plugins switches a control on or off, and AI driven is
//     only touched by ownTheCharacter (which #2606 takes out for #2387)
//   - the five second input line still reads all eight flags itself, names
//     the ones that are off, and names what the server holds off on purpose
//     (sp.storage.thornswoodControlsHeld, #2618) on its own as held
//   - #2618's skip lines and enableAllBut went with the two pieces; the held
//     record and heldOff stay
//
// Run it against the plugin before the change with FRONT=<that file>: the
// removal cases fail there.
//
//   node game/tests/test-2620-no-control-rescues.js
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const FRONT = process.env.FRONT || path.join(ROOT, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// Code only: block and line comments out, strings kept.
function code(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}
const body = code(front);

// ---------------------------------------------------------------- the watchdog
yes('no controlsTick', !/\bcontrolsTick\b/.test(body));
yes("no update handler named 'controls'", body.indexOf("guard('controls'") < 0);
yes('no controlsOffNow, controlsSince or controlsTickAt',
    !/\b(controlsOffNow|controlsSince|controlsTickAt)\b/.test(body));
yes('no cached controls read for a tick (readControls, controlsCached)',
    !/\breadControls\s*\(/.test(body) && !/\bcontrolsCached(At)?\b/.test(body));
yes('no "turned them back on" line', front.indexOf('turned them back on') < 0);
yes('no "tried to turn controls back on" line', front.indexOf('tried to turn controls back on') < 0);

// ------------------------------------------------------------ the stuck rescue
yes("no update handler named 'stuck'", body.indexOf("guard('stuck'") < 0);
yes('no stuckKeys, stuckMoveKeys, stuckAt, stuckPos or lastRescue',
    !/\b(stuckKeys|stuckMoveKeys|stuckAt|stuckPos|lastRescue)\b/.test(body));
yes('no lastActivateAt (only the rescue read it)', !/\blastActivateAt\b/.test(body));
yes('no "stuck: N keys" or "not calling it stuck" line',
    front.indexOf("say('stuck: '") < 0 && front.indexOf('not calling it stuck') < 0);

// ------------------------------------------- nothing switches controls itself
const PLUGINS = path.join(ROOT, 'game', 'plugins');
const files = process.env.FRONT ? [FRONT] :
  fs.readdirSync(PLUGINS).filter(function (n) { return /\.js$/.test(n); })
    .map(function (n) { return path.join(PLUGINS, n); });
const switches = [];
const aiDriven = [];
files.forEach(function (f) {
  const c = code(fs.readFileSync(f, 'utf8').split(CR).join(''));
  if (/\b(enablePlayerControls|disablePlayerControls)\s*\(/.test(c)) { switches.push(path.basename(f)); }
  const m = c.match(/\bsetPlayerAIDriven\s*\(/g);
  if (m) { aiDriven.push(path.basename(f) + ' x' + m.length); }
});
yes('no plugin in game\\plugins calls enablePlayerControls or disablePlayerControls' +
    (switches.length ? ' (' + switches.join(', ') + ')' : ''), switches.length === 0);

// ownTheCharacter's own heartbeat is #2387's to take out (#2606). Until that
// lands it is the only place left that touches AI driven.
const own = (function () {
  const a = body.indexOf('function ownTheCharacter(');
  if (a < 0) { return ''; }
  const b = body.indexOf('\n  }\n', a);
  return b < 0 ? '' : body.slice(a, b);
})();
const aiOutsideOwn = (body.match(/\bsetPlayerAIDriven\s*\(/g) || []).length -
                     (own.match(/\bsetPlayerAIDriven\s*\(/g) || []).length;
yes('setPlayerAIDriven is called nowhere in the front plugin but ownTheCharacter (got ' +
    aiOutsideOwn + ' outside it; files: ' + (aiDriven.join(', ') || 'none') + ')', aiOutsideOwn === 0);

// ----------------------------------------------- the held record stays (#2618)
yes('heldOff still reads sp.storage.thornswoodControlsHeld',
    /function heldOff\(\) \{[\s\S]*?sp\.storage\.thornswoodControlsHeld/.test(body));
yes('enableAllBut is gone with the two pieces that called it', !/\benableAllBut\b/.test(body));
yes('no held-control filter is left over from the watchdog',
    !/readControls\(\)\.filter/.test(body) && !/enableAllBut\(held/.test(body));

// --------------------------------------------- the input line keeps the reading
const CONTROL_NAMES = ['movement', 'fighting', 'camera', 'looking', 'sneaking', 'menus', 'activate', 'journal'];
const tableAt = front.indexOf('  const CONTROLS = [');
const table = tableAt < 0 ? '' : front.slice(tableAt, front.indexOf('];', tableAt));
yes('the CONTROLS table still names all eight flags',
    CONTROL_NAMES.every(function (n) { return table.indexOf("['" + n + "'") >= 0; }));
const pc = (function () {
  const a = front.indexOf('  function pulseControls() {');
  if (a < 0) { return null; }
  const b = front.indexOf('\n  }\n', a);
  return b < 0 ? null : front.slice(tableAt, b + 4);
})();
yes('pulseControls is in the plugin, after the CONTROLS table', !!pc && tableAt >= 0);

const pulseAt = front.indexOf("  sp.on('update', guard('pulse', () => {");
const pulseEnd = pulseAt < 0 ? -1 : front.indexOf('\n  }));\n', pulseAt);
const pulse = (pulseAt >= 0 && pulseEnd >= 0) ? front.slice(pulseAt, pulseEnd) : '';
yes('the pulse reads the controls itself, through pulseControls',
    /const controls = pulseControls\(\);/.test(pulse));
yes("and still writes them into the input line",
    /say\('input: ' \+ keysSeen \+ ' keys in 5s, browser focus ' \+ focused \+\s*', menu ' \+ menu \+ names \+ controls \+ where\);/.test(pulse));
yes('the keys handler still counts keysSeen for that line',
    /guard\('keys', \(e\) => \{\n {4}keysSeen\+\+;/.test(front));

if (pc) {
  function run(offNames, extra, storage) {
    const reads = { n: 0, other: 0 };
    const map = {
      movement: 'isMovementControlsEnabled', fighting: 'isFightingControlsEnabled',
      camera: 'isCamSwitchControlsEnabled', looking: 'isLookingControlsEnabled',
      sneaking: 'isSneakingControlsEnabled', menus: 'isMenuControlsEnabled',
      activate: 'isActivateControlsEnabled', journal: 'isJournalControlsEnabled'
    };
    const Game = {
      getPlayer: function () { reads.other++; return null; },
      enablePlayerControls: function () { reads.other++; },
      disablePlayerControls: function () { reads.other++; },
      setPlayerAIDriven: function () { reads.other++; }
    };
    Object.keys(map).forEach(function (n) {
      Game[map[n]] = function () { reads.n++; return offNames.indexOf(n) < 0; };
    });
    if (extra) { extra(Game); }
    const fn = new Function('sp', 'Date', 'var seatedInFurniture = false;\n' + pc + '\nreturn pulseControls;');
    const line = fn({ Game: Game, storage: storage || {} }, { now: function () { return 1000; } })();
    return { line: line, reads: reads };
  }
  const on = run([]);
  yes('all on: ", controls on" (' + on.line + ')', on.line === ', controls on');
  yes('one line asks each flag once and nothing else (' + on.reads.n + ' flags, ' + on.reads.other + ' other)',
      on.reads.n === 8 && on.reads.other === 0);
  const off = run(['movement', 'camera', 'journal']);
  yes('three off are named in table order (' + off.line + ')',
      off.line === ', controls off [movement, camera, journal]');
  yes('and nothing is switched back on', off.reads.other === 0);
  const gone = run([], function (G) { delete G.isJournalControlsEnabled; });
  yes('a build without one of the natives still reads the rest (' + gone.line + ')',
      gone.line === ', controls on' && gone.reads.n === 7);
  const cuffed = run(['fighting'], null, { thornswoodControlsHeld: { fighting: 'cuffed' } });
  yes('cuffed: fighting is named held, not off (' + cuffed.line + ')', cuffed.line === ', controls on, held [fighting]');
  yes('and it is not switched back on', cuffed.reads.other === 0);
  const both = run(['fighting', 'looking'], null, { thornswoodControlsHeld: { fighting: 'cuffed' } });
  yes('cuffed with looking off too: both named, apart (' + both.line + ')', both.line === ', controls off [looking], held [fighting]');
  const freed = run([], null, { thornswoodControlsHeld: { fighting: undefined } });
  yes('freed (the record cleared): nothing held (' + freed.line + ')', freed.line === ', controls on');
  const threw = run([], function (G) { G.isLookingControlsEnabled = function () { throw new Error('no'); }; });
  yes('a native that throws does not take the line down (' + threw.line + ')', threw.line === ', controls on');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
