// test-614-riekling-clothes-remount.js
//
// #614 Goblin/Riekling clothes: the neck sits wrong and the body shows through
// on rejoin and on leaving a building.
//
// What answered it took every worn piece off and put it back on at each cell
// change. On 4 October that is what left a Riekling Blue tester undressed on
// arriving in Whiterun from the creation hall and again at a door, so it is
// gone, and the cause is measured instead. This holds both:
//
//   - nothing in the front plugin takes clothes off and puts them back on;
//   - the race read writes down, once a cell, the character's own race and its
//     base record's race (skymp5-client sets only the base record's), changes
//     nothing, and looks four times a second rather than every frame (#963:
//     the old watcher was the costliest handler in the frame, 599 ms in 30 s,
//     because it read the race on every frame for everybody).
//
// It lifts the real raceReadTick out of the plugin and runs it on a fake clock
// and a fake game. FRONT points it at another copy of the file.
//
//   node game/tests/test-614-riekling-clothes-remount.js
'use strict';
const fs = require('fs');
const path = require('path');
const FRONT = process.env.FRONT ||
  path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');
const code = front.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------- the remount is gone
for (const gone of ['remountWornClothes', 'clothesRemountTick', 'scheduleSpawnClothesRemount',
                    'raceNeedsClothesRemount']) {
  yes('no ' + gone + ' left in the front plugin', !new RegExp('\\b' + gone + '\\b').test(code));
}
yes('nothing in the front plugin takes worn clothes off and puts them back on',
  !/unequipItem\(form, false, true\);\s*ac\.equipItem\(form, false, true\)/.test(code));

// ------------------------------------------------------------- the race read
const a = front.indexOf('  let raceReadCell = -1;');
const b = a < 0 ? -1 : front.indexOf('\n  }\n', front.indexOf('  function raceReadTick() {', a));
yes('the race read is in the plugin', a >= 0 && b > a);
yes('and registered on update', /guard\('race read', raceReadTick\)/.test(code));

function world(own, base) {
  const clock = { now: 1700000000000 };
  let calls = 0, changes = 0;
  const lines = [];
  const state = { cell: 0x1000 };
  const race = (name, id) => ({ getName() { calls++; return name; }, getFormID() { calls++; return id; } });
  const pc = {
    getParentCell() { calls++; return { getFormID() { calls++; return state.cell; } }; },
    getBaseObject() { calls++; return { base: true }; },
    equipItem() { changes++; }, unequipItem() { changes++; }, queueNiNodeUpdate() { changes++; },
  };
  const sp = {
    Game: { getPlayer() { calls++; return pc; } },
    Actor: { from(x) { calls++; return { getRace() { calls++; return race(own[0], own[1]); },
      equipItem() { changes++; }, unequipItem() { changes++; }, queueNiNodeUpdate() { changes++; } }; } },
    ActorBase: { from() { calls++; return { getRace() { calls++; return race(base[0], base[1]); } }; } },
  };
  const tick = new Function('sp', 'log', 'Date', front.slice(a, b + 4) + '\nreturn raceReadTick;')(
    sp, l => lines.push(l), { now: () => clock.now });
  return { clock, state, tick, lines, calls: () => calls, reset() { calls = 0; }, changes: () => changes };
}

if (a >= 0 && b > a) {
  const w = world(['Nord', 0x13746], ['Riekling Blue', 0x5a0ab1]);
  w.tick();
  yes('the first cell is written down, with both races',
    w.lines.length === 1 && /race at cell 1000: the character Nord 13746, its base record Riekling Blue 5a0ab1, NOT THE SAME/.test(w.lines[0]));
  w.reset();
  for (let i = 0; i < 60; i++) { w.clock.now += 16; w.tick(); }
  yes('a second of frames in the same cell calls into the game about four times over, not sixty (' + w.calls() + ' calls)',
    w.calls() <= 4 * 4 + 4);
  yes('and writes nothing more', w.lines.length === 1);
  w.state.cell = 0x2000;
  for (let i = 0; i < 30; i++) { w.clock.now += 16; w.tick(); }
  yes('walking through a door writes the new cell down within half a second, once',
    w.lines.length === 2 && /race at cell 2000/.test(w.lines[1]));
  yes('and the read changes nothing on the character', w.changes() === 0);

  const same = world(['Nord', 0x13746], ['Nord', 0x13746]);
  same.tick();
  yes('the same race on both says so by saying nothing more',
    same.lines.length === 1 && !/NOT THE SAME/.test(same.lines[0]));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
