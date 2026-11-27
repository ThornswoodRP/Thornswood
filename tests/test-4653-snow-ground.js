// test-4653-snow-ground.js
//
// #4653. The snow place is standing in snow on the ground, but the front
// plugin said snow only while the weather was snowing: a clear day in deep
// snow counted as plain outdoors, and a snowfall on bare ground as snow.
//
//   G  the ground under a person is read in the game, from the land's own
//      material through Papyrus Extender's GetLandMaterialType, and a read
//      that throws says why instead of failing in silence.
//   P  the place word: snow on the ground on a clear day is snow, a snowfall
//      on bare ground is not, and water, wading and a roof still win.
//   D  the cold page says so.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// A Windows checkout ends lines with CR LF; the slices below are cut at LF.
const front = fs.readFileSync(path.join(ROOT, 'game', 'plugins', 'thornswood-front.js'), 'utf8').replace(/\r\n/g, '\n');
const from = front.indexOf('const SNOW_GROUND');
const to = front.indexOf('\n  }\n', front.indexOf('function placeKind(')) + 4;
let make = null;
try {
  make = new Function('sp', front.slice(from, to) +
    '\nreturn { groundUnder: groundUnder, placeKind: placeKind, why: () => groundWhy };');
} catch (e) { make = null; }
yes('G0 the ground read and the place word can be read on their own', !!make && from >= 0 && to > from);

if (make) {
  // GetLandMaterialType answers this material, or throws this.
  function game(answer) {
    const asked = [];
    const sp = {
      callNative: (cls, fn, self, x, y, z) => {
        asked.push([cls, fn, self, x, y, z]);
        if (answer instanceof Error) throw answer;
        return answer;
      }
    };
    return { w: make(sp), asked };
  }
  const snow = game('Snow');
  yes('G1 the ground is the land material at the feet, from Papyrus Extender',
      snow.w.groundUnder(100, 200, 300) === 'Snow' &&
      JSON.stringify(snow.asked) === JSON.stringify([['PO3_SKSEFunctions', 'GetLandMaterialType', undefined, 100, 200, 300]]));
  const broken = game(new Error('no such function'));
  yes('G2 a read that throws gives no ground and says why',
      broken.w.groundUnder(0, 0, 0) === '' && /GetLandMaterialType threw: no such function/.test(broken.w.why()));
  yes('G2 and a read that works again clears it', (() => {
    const g = game('Dirt'); g.w.groundUnder(0, 0, 0); return g.w.why() === '';
  })());

  const kind = snow.w.placeKind;
  const CLEAR = 0, RAIN = 2, SNOWING = 3;
  yes('P1 snow on the ground on a clear day is the snow place', kind({ ground: 'Snow', sky: CLEAR }) === 'snow');
  yes('P1 and snowy steps are too', kind({ ground: 'SnowStairs', sky: CLEAR }) === 'snow');
  yes('P2 a snowfall on bare ground is not', kind({ ground: 'Dirt', sky: SNOWING }) === 'outdoors');
  yes('P2 nor on ground that was not read', kind({ ground: '', sky: SNOWING }) === 'outdoors');
  yes('P3 snow underfoot wins over rain falling', kind({ ground: 'Snow', sky: RAIN }) === 'snow');
  yes('P3 rain on bare ground is rain', kind({ ground: 'Grass', sky: RAIN }) === 'rain');
  yes('P4 swimming, wading and a roof still win over snow underfoot',
      kind({ swimming: true, ground: 'Snow' }) === 'water' &&
      kind({ wading: true, ground: 'Snow' }) === 'shallow' &&
      kind({ indoors: true, ground: 'Snow' }) === 'indoors');
}

const tick = front.slice(front.indexOf("sp.on('update', guard('place'"));
yes('P5 the place tick asks the ground only outdoors and out of the water, and the weather is no longer the place',
    /const ground = \(swimming \|\| wading \|\| indoors\) \? '' : groundUnder\(px, py, pz\);/.test(tick) &&
    /placeKind\(\{ swimming: swimming, wading: wading, indoors: indoors, ground: ground, sky: sky \}\)/.test(tick) &&
    !/sky === 3\) \{ kind = 'snow'/.test(front));
yes('P6 the heartbeat names the ground and any read that threw', /'  \[ground ' \+ \(ground \|\| 'not read'\) \+ \(groundWhy/.test(tick));

const page = fs.readFileSync(path.join(ROOT, 'docs', 'systems', 'temperature.md'), 'utf8');
yes('D1 the cold page names snow on the ground as the place', /\| Snow on the ground \| 16 \|/.test(page) && /#4653/.test(page));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
