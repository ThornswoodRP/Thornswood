// test-4653-ground-probe.js
//
//     node tests/test-4653-ground-probe.js
//
// #4653. The snow place is meant to be snow on the ground, and the front's
// place tick says snow only while snow falls. Patrick decided on 26 Oct that
// the ground is measured in the client. Before the word changes, the place
// tick writes down what Papyrus Extender's land material reads under the
// feet (PO3_SKSEFunctions.GetLandMaterialType through callNative), so a Dev
// session's front log shows whether it answers and what snow reads as.
//
// What it checks:
//   1. the probe sits in the place tick before the word is picked, asks only
//      outdoors and out of the water, and the word itself is not changed yet;
//   2. the probe run on its own: an answer is written once with the sky and
//      the position, a second tick with the same answer writes nothing, a
//      change is written again, no answer and a throw are written as such,
//      and indoors or swimming nothing is asked;
//   3. the half minute line carries the ground too.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const front = fs.readFileSync(path.join(ROOT, 'game/plugins/thornswood-front.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ---- 1. where it sits ---------------------------------------------------------
console.log('where it sits');
const tick = front.indexOf("sp.on('update', guard('place', () => {");
const start = front.indexOf("    let ground = '';", tick);
const end = front.indexOf("    let kind = 'outdoors';", tick);
yes('the probe is in the place tick, before the place word is picked', tick > 0 && start > tick && end > start);
const probe = start > 0 && end > start ? front.slice(start, end) : '';
yes('it asks Papyrus Extender for the land material at the feet',
  probe.includes("sp.callNative('PO3_SKSEFunctions', 'GetLandMaterialType', undefined, px, py, pz)"));
yes('only outdoors and out of the water', probe.includes('if (!indoors && !swimming) {'));
yes('the place word is still picked from the sky alone until the log shows what snow reads as',
  front.includes("    else if (sky === 3) { kind = 'snow'; }") && !/kind = 'snow'[^;]*ground/.test(front));
yes('what was last written down starts empty', front.includes("  let groundSaid = '';"));

// ---- 2. the probe run ------------------------------------------------------------
console.log('');
console.log('the probe');
if (probe) {
  const said = [];
  let answer = 'Snow';
  let throws = false;
  let asked = 0;
  const ctx = {
    said: said, groundSaid: '',
    say: function (l) { said.push(l); },
    sp: { callNative: function (cls, fn, self, x, y, z) {
      asked++;
      if (throws) { throw new Error('no such script'); }
      return answer;
    } },
    String: String, Math: Math
  };
  const run = function (vars) {
    const v = Object.assign({ indoors: false, swimming: false, sky: 0, px: 1000.4, py: -2000.6, pz: 300 }, vars || {});
    vm.runInNewContext('(function(){var indoors=' + v.indoors + ',swimming=' + v.swimming + ',sky=' + v.sky +
      ',px=' + v.px + ',py=' + v.py + ',pz=' + v.pz + ';\n' + probe + '\nthis.lastGround = ground;}).call(this);', ctx);
  };
  run();
  yes('an answer is written once, with the sky and where', said.length === 1 &&
    said[0] === 'ground under the feet: Snow, the sky 0, at 1000 -2001 300');
  run();
  yes('the same answer on the next tick writes nothing', said.length === 1);
  answer = 'Stone';
  run({ sky: 3 });
  yes('a change is written again', said.length === 2 && said[1] === 'ground under the feet: Stone, the sky 3, at 1000 -2001 300');
  answer = null;
  run();
  yes('no answer is written as no answer', said[2] === 'ground under the feet: no answer, the sky 0, at 1000 -2001 300');
  throws = true;
  run();
  yes('a throw is written with its reason', said[3] === 'ground under the feet: threw: no such script, the sky 0, at 1000 -2001 300');
  throws = false;
  answer = 'Snow';
  const before = asked;
  run({ indoors: true });
  run({ swimming: true });
  yes('indoors or swimming nothing is asked and nothing is written', asked === before && said.length === 4 && ctx.lastGround === '');
}

// ---- 3. the half minute line ------------------------------------------------------
console.log('');
console.log('the half minute line');
yes('it carries the ground beside the water', front.includes("(ground ? '  [ground: ' + ground + ']' : '') + looking);"));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
