// #2259: a crafting station (forge, skyforge, smelter, kiln, cooking spit)
// warms you but never sets you on fire. Before: using the Whiterun forge read
// as standing in the coals and gave a bad burn within seconds.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const FRONT = fs.readFileSync(path.join(REPO, 'game', 'plugins', 'thornswood-front.js'), 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } }

// 1. The plugin's craft marks are exactly the table's kind "craft".
const table = JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'fires.json'), 'utf8')).fires;
const want = table.filter(f => f.kind === 'craft').map(f => f.file.toLowerCase() + ':' + parseInt(f.local, 16)).sort();
const listed = /const FIRE_BASES = \[([\s\S]*?)\n  \];/.exec(FRONT);
const marked = listed ? (listed[1].match(/\['[^']+',\s*0x[0-9a-f]+,\s*'craft'\]/g) || []).map(t => {
  const m = /\['([^']+)',\s*(0x[0-9a-f]+)/.exec(t); return m[1].toLowerCase() + ':' + parseInt(m[2], 16);
}).sort() : [];
yes('every craft row in fires.json is marked craft in FIRE_BASES (' + want.length + ')',
    want.length > 0 && JSON.stringify(want) === JSON.stringify(marked));
yes('the forge Whiterun uses (CraftingBlackSmithForgeWR) is one of them', marked.indexOf('skyrim.esm:' + 0xbf9e1) >= 0);

// 2. The catch reads the nearest non-station fire, not the nearest fire.
yes('the catch check reads fireFlame', /if \(fireFlame >= 0 && fireFlame <= FIRE_INSIDE\)/.test(FRONT));
yes('and not the warmth distance', !/if \(fire >= 0 && fire <= FIRE_INSIDE\)/.test(FRONT));

// 3. Run fireNearest itself.
const at = FRONT.indexOf('  function fireNearest(');
yes('fireNearest is in the plugin', at >= 0);
if (at >= 0) {
  const end = FRONT.indexOf('\n  }\n', at);
  const body = FRONT.slice(at, end + 4);
  const run = new Function('FIRE_REACH', 'FIRE_INSIDE', 'fireCraft',
    'let fireFlame = -1;' + body + '; return function (px, py, pz, spots, best) { fireFlame = -1; const d = fireNearest(px, py, pz, spots, best); return [d, fireFlame]; };');
  const near = run(300, 90, { 777: true });
  let r = near(0, 0, 0, [[10, 0, 0, 777]], -1);
  yes('at a forge: warm (distance 10)', r[0] === 10);
  yes('at a forge: not in the fire', r[1] === -1);
  r = near(0, 0, 0, [[0, 0, 0, 777]], 0);
  yes('seated at a forge: warm at 0, still not alight', r[0] === 0 && r[1] === -1);
  r = near(0, 0, 0, [[10, 0, 0, 777], [50, 0, 0, 555]], -1);
  yes('a campfire beside the forge still burns (50)', r[0] === 10 && r[1] === 50);
  r = near(0, 0, 0, [[400, 0, 0, 555]], -1);
  yes('a fire out of reach is nothing', r[0] === -1 && r[1] === -1);
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
