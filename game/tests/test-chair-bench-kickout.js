// test-chair-bench-kickout.js
//
// Chair/bench kick-out (#843).
//
// Sitting turns player controls off with no menu. The controls watchdog,
// stuck rescue and ownTheCharacter used to fight that by calling
// enablePlayerControls / setPlayerAIDriven(false), which stands people up.
// notOurs() already treated getFurnitureReference as intentional; the ref
// can still flicker null while seated. The fix adds a furnitureEnter/Exit
// seated flag and getSitState, so any one signal says "in furniture".
//
// The watchdog and the stuck rescue are gone (#2620). notOurs() stays for
// ownTheCharacter and the jump and sprint gates, so this drives it alone and
// checks that the controls block switches nothing on.
//
//   node game/tests/test-chair-bench-kickout.js
'use strict';
const fs = require('fs');
const path = require('path');
const FRONT = process.env.FRONT ||
  path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

yes('front names the chair/bench kick-out work', /Chair\/bench kick-out \(#843\)/.test(front));
yes('front keeps a seatedInFurniture flag', /let seatedInFurniture = false;/.test(front));
yes('furnitureEnter sets seated for any player furniture',
    /seatedInFurniture = true;/.test(front) &&
    /furnitureEnter/.test(front));
yes('furnitureExit clears seated', /seatedInFurniture = false;/.test(front) &&
    /furnitureExit/.test(front));
yes('notOurs checks the seated flag',
    /typeof seatedInFurniture !== 'undefined' && seatedInFurniture/.test(front));
yes('notOurs still checks getFurnitureReference',
    /getFurnitureReference\(\)/.test(front));
yes('notOurs checks getSitState',
    /getSitState/.test(front) && /if \(sit\) \{ return 'in furniture'; \}/.test(front));

// Drive the real notOursNow / notOurs out of the plugin.
const START = '  const CONTROLS = [';
const END_MARK = '  function pulseControls() {';
const a = front.indexOf(START);
const b = a < 0 ? -1 : front.indexOf(END_MARK, a);
const block = (a >= 0 && b >= 0) ? front.slice(a, b) : null;
yes('the controls block (CONTROLS through notOurs) still extracts', !!block);
yes('the controls block switches nothing on and takes nobody off the AI (#2620)',
    !!block && !/enablePlayerControls|setPlayerAIDriven/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')));

function harness(opts) {
  opts = opts || {};
  const clock = { t: 1000 };
  const player = {
    isDead: function () { return !!opts.dead; },
    getFurnitureReference: function () { return opts.furniture || null; },
    getSitState: function () { return opts.sitState || 0; }
  };
  const sp = { Game: { getPlayer: function () { return opts.noPlayer ? null : player; } } };
  const FakeDate = { now: function () { return clock.t; } };
  // seatedInFurniture is declared outside the CONTROLS extract in the plugin.
  // Mirror it here so the typeof-guard path can be driven.
  const prelude = 'var seatedInFurniture = ' + (opts.seated ? 'true' : 'false') + ';\n';
  const fn = new Function('sp', 'Date', prelude + block + '\nreturn { notOurs: notOurs };');
  return fn(sp, FakeDate);
}

if (block) {
  yes('standing: notOurs says nothing', harness({}).notOurs() === '');
  yes('dead: notOurs says dead', harness({ dead: true }).notOurs() === 'dead');
  yes('furniture ref: notOurs says in furniture', harness({ furniture: { id: 1 } }).notOurs() === 'in furniture');
  yes('getSitState 3 alone (ref flickered null): in furniture', harness({ sitState: 3 }).notOurs() === 'in furniture');
  yes('seated flag alone (ref and sit state empty): in furniture', harness({ seated: true }).notOurs() === 'in furniture');
  yes('getSitState 4 (standing up): in furniture', harness({ sitState: 4 }).notOurs() === 'in furniture');
  yes('no character: notOurs says nothing', harness({ noPlayer: true }).notOurs() === '');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
