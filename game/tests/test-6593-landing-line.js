// test-6593-landing-line.js
//
// Where a load puts the character, and which camera it is in (#6593, #6594).
//
// Dev Test #1 on 18 Nov: one tester spawned up in the air, another spawned in
// first person with the mouse wheel doing nothing for a while. Their game logs
// could not say either: the first feet height was a place line 35 to 50 s
// after the load, and the camera came only from a "looking at" line. The
// front now writes a landing line at 0.25, 1, 3 and 6 s after each arrival:
// the feet, whether the game has the character in the air, the camera and
// whether a menu is up.
//
// Runs the real landingSaid, landingKey and the landing tick out of
// game/plugins/thornswood-front.js over a stand-in sp. Read only.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const CR = String.fromCharCode(13);
const front = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js'), 'utf8')
  .split(CR).join('');

const a = front.indexOf('  function landingSaid(pc) {');
const b = front.indexOf('  }));', a);
yes('the landing probe is in the front plugin', a > 0 && b > a);

if (a > 0 && b > a) {
  const block = front.slice(a, b + '  }));'.length);
  const clock = { now: 1000000 };
  const lines = [];
  const pc = {
    x: 0, y: 0, z: -12865, air: false, cell: { interior: false, id: 0x2f19bad4 }, world: 0x3c,
    getPositionX() { return this.x; }, getPositionY() { return this.y; }, getPositionZ() { return this.z; },
    getAnimationVariableBool(n) { return n === 'bInJumpState' ? this.air : false; },
    getParentCell() { const c = this.cell; return { isInterior: () => c.interior, getFormID: () => c.id }; },
    getWorldSpace() { const w = this.world; return w ? { getFormID: () => w } : null; }
  };
  const state = { cam: 0, menu: false, player: pc };
  let tick = null;
  const sp = {
    on(ev, f) { if (ev === 'update') { tick = f; } },
    Game: { getPlayer: () => state.player, getCameraState: () => state.cam },
    Utility: { isInMenuMode: () => state.menu }
  };
  const FakeDate = { now: () => clock.now };
  new Function('sp', 'log', 'guard', 'Date', block)(
    sp, function () { lines.push(Array.prototype.join.call(arguments, ' ')); },
    function (n, f) { return f; }, FakeDate);
  yes('the probe registers an update handler', typeof tick === 'function');

  function run(ms) {
    const end = clock.now + ms;
    while (clock.now < end) { tick(); clock.now += 50; }
  }

  // The first world: outdoors in Tamriel, first person, falling from above.
  pc.z = -12700; pc.air = true; state.cam = 0;
  run(400);
  yes('the first world is an arrival, and a line comes 0.25 s after it',
      lines.length === 1 && /^landing: 250ms after arriving in world 3c, /.test(lines[0]));
  yes('it gives the feet height', /feet at -12700,/.test(lines[0]));
  yes('it says the game has the character in the air', /in the air yes,/.test(lines[0]));
  yes('it names the camera', /camera first person,/.test(lines[0]));
  yes('it says whether a menu is up', /menu no$/.test(lines[0]));
  pc.z = -12820; pc.air = false; state.cam = 9;
  run(6000);
  yes('then at 1, 3 and 6 s, four lines in all, and no more', lines.length === 4 &&
      /^landing: 1000ms/.test(lines[1]) && /^landing: 3000ms/.test(lines[2]) && /^landing: 6000ms/.test(lines[3]));
  yes('a fall shows as the height dropping and the camera change as it came',
      /feet at -12820, in the air no, camera third person/.test(lines[3]));
  run(10000);
  yes('nothing more while the character stays put', lines.length === 4);

  // Walking across exterior cells in the same worldspace is not an arrival.
  pc.cell = { interior: false, id: 0x9999 }; pc.x += 500;
  run(2000);
  yes('a new exterior cell in the same worldspace is not an arrival', lines.length === 4);

  // A teleport within the worldspace is.
  pc.x += 50000;
  run(400);
  yes('a jump of more than 2000 units is an arrival', lines.length === 5 && /^landing: 250ms after arriving in world 3c/.test(lines[4]));
  run(7000);

  // A door into an interior is.
  const before = lines.length;
  pc.cell = { interior: true, id: 0x16789 }; pc.world = 0;
  run(400);
  yes('a new interior cell is an arrival, named by the cell',
      lines.length === before + 1 && /arriving in cell 16789/.test(lines[before]));

  // A game that answers nothing still gets its line.
  const quiet = new Function('sp', block.slice(0, block.indexOf('  // Where the character is')) + '\nreturn landingSaid;')({
    Game: { getCameraState() { throw new Error('no'); } }, Utility: { isInMenuMode() { throw new Error('no'); } }
  });
  let threw = false, l2 = '';
  try { l2 = quiet({}); } catch (e) { threw = true; }
  yes('a game that answers none of it still gets its line',
      !threw && l2 === 'feet at unknown, in the air unknown, camera -1, menu unknown');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
