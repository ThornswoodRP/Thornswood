// test-2302-placed-water.js
//
// #2302: wading is decided by water above the feet, never by a guessed slack
// under them, and the placed water the cell walk keeps counts.
//
// WHAT WAS MEASURED, read out of Skyrim.esm on One (16 Oct): the Temple of
// Kynareth, CELL 165a7, has XCLW 0, so getWaterLevel answers 0, and its pool
// is Water1024ClearAnkleStill (ACTI 74ee9, WNAM water cb11f), placed at z 48. Nothing in
// the room stands lower than z 32. FEET_SLACK = 24 counted wading only for
// feet under z 24, so the pool never counted. This runs the real
// placedWaterAt over those numbers, and checks the table the build installs.
//
// Read only.
const fs = require('fs');
const path = require('path');
const REPO_DIR = path.join(__dirname, '..', '..');
const SRC = process.env.FRONT || path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function lift(fnName) {
  const f = src.indexOf('  function ' + fnName + '(');
  if (f < 0) { return null; }
  const b = src.indexOf('\n  }\n', f);
  return b < 0 ? null : src.slice(f, b + 5);
}

yes('no guessed feet slack is left', !/FEET_SLACK/.test(src));
const m = /^  const PLACED_WATERS = (.*);$/m.exec(src);
yes('the client carries the placed water table', !!m);
let rows = [];
try { rows = JSON.parse(m[1]); } catch (e) { rows = null; }
yes('and it is a list of [plugin, id, x1, y1, x2, y2]', Array.isArray(rows) &&
    rows.every(function (r) { return r.length === 6 && typeof r[0] === 'string' && r[2] < r[4] && r[3] < r[5]; }));
const pool = (rows || []).filter(function (r) { return r[0] === 'Skyrim.esm' && r[1] === 0x74ee9; })[0];
yes('and the temple pool, Water1024ClearAnkleStill 74ee9 (water cb11f), is in it with its 1024 footprint',
    !!pool && pool[4] - pool[2] === 1024 && pool[5] - pool[3] === 1024);

const resolve = lift('resolveWaterIds');
const at = lift('placedWaterAt');
yes('the placed water code is in the plugin', !!resolve && !!at);
const wade = /const WADE_DEEP = (\d+);/.exec(src);
if (resolve && at && wade && pool) {
  const sp = {
    Game: { getFormEx: function (id) { return { id: id }; },
            getFormFromFile: function () { return null; } },
    Form: { from: function (r) { return r ? { getFormID: function () { return r.id; } } : null; } }
  };
  const api = new Function('sp', 'PLACED_WATERS',
    'let waterBox = null;\n' + resolve + at + '\nreturn { resolve: resolveWaterIds, at: placedWaterAt };')(sp, [pool]);
  api.resolve();
  const D = Number(wade[1]);
  const here = [[0, 0, 48, 0x74ee9]];   // the temple pool, at its placed z
  const inPool = api.at(10, -20, 32, here, D);
  yes('standing in the temple pool on its floor (feet 32, surface 48) is wading, 16 deep',
      !!inPool && inPool.id === 0x74ee9 && inPool.deep === 16);
  yes('the old rule said dry for the same feet: 0 - 32 is not above -24', !((0 - 32) > -24));
  yes('standing beside the pool is not', api.at(900, 0, 32, here, D) === null);
  yes('standing on the rim above the surface is not', api.at(0, 0, 60, here, D) === null);
  yes('deeper than wading is not wading', api.at(0, 0, 48 - D - 1, here, D) === null);
  yes('water nobody resolved counts for nothing', api.at(0, 0, 32, [[0, 0, 48, 0x123]], D) === null);
}
yes('the cell plane counts only above the feet', /wading = deep > 0 && deep < WADE_DEEP;/.test(src));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
