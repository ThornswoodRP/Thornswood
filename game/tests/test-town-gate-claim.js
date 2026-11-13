// test-town-gate-claim.js
//
// City gates are claimable properties (#615).
//
// Build-DoorTable only maps doors into interiors, so town gates were never
// buildings. /claim at the Whiterun gate fell through to farming ("Only a
// farmer can bring a crop in"). Patrick decided gates SHOULD be claimable
// via the mold flow. This checks the tables, that the lock script shuts a
// claimed gate, and that the client's gate timer is gone (#2484).
//
//   node game/tests/test-town-gate-claim.js
'use strict';
const fs = require('fs');
const path = require('path');
const GM = path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const FRONT = path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(GM, 'utf8').split(CR).join('');
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

yes('Whiterun outer gate maps to a building', /'1b1f1:Skyrim\.esm':\s*'gate:whiterun-main'/.test(gm));
yes('Whiterun inner gate maps to the same building', /'1b1f3:Skyrim\.esm':\s*'gate:whiterun-main'/.test(gm));
yes('Riften gates map to a building', /'42284:Skyrim\.esm':\s*'gate:riften-main'/.test(gm) && /'42286:Skyrim\.esm':\s*'gate:riften-main'/.test(gm));
yes('Whiterun gate has a plain name', /'gate:whiterun-main':\s*'Whiterun Main Gate'/.test(gm));
yes('Riften gate has a plain name', /'gate:riften-main':\s*'Riften Main Gate'/.test(gm));
yes('Whiterun inside leaf is a way out', /'1b1f3:Skyrim\.esm':\s*1/.test(gm) && /addTownGateProperties/.test(gm));
yes('lockScript publishes __thornswoodPropertyShut', /__thornswoodPropertyShut/.test(gm));
// Since #2484 the client no longer opens the gates on a timer: the outer
// leaves load unlocked from Thornswood-Last.esp, and the lock script above is
// what shuts a claimed one, so nothing on the client can force it back open.
yes('nothing on the client opens the town gates on a timer any more (#2484)',
    !/openTheGates|TOWN_GATES|GATE_EVERY_MS/.test(front));
yes('the lock script locks every door property wants shut, on its own', /r\.lock\(true, false\)/.test(gm));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
