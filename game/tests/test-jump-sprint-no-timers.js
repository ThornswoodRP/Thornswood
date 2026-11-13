// test-jump-sprint-no-timers.js
//
// #2387: IsNPC and bSprintOK were put back on timers by ownTheCharacter,
// holdNpcClear and holdSprintGate. The cause they were chasing was another
// launcher's MpClientPlugin.dll, gone since the fork's client (1.1.61.1), and
// nothing in the fork writes either gate on the local character. The three
// are removed; the probe stays and only reads.
//
//   node game/tests/test-jump-sprint-no-timers.js
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

// Code only, so a comment naming the old functions does not count.
const code = front.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

for (const name of ['ownTheCharacter', 'holdNpcClear', 'holdSprintGate']) {
  yes(name + ' is gone', !new RegExp('\\b' + name + '\\b').test(code));
}
yes('no heartbeat state left', !/\bownedAt\b/.test(code));
yes('nothing writes IsNPC', !/setAnimationVariable\w*\(\s*['"]IsNPC['"]/.test(code));
yes('nothing holds bSprintOK open', !/setAnimationVariable\w*\(\s*['"]bSprintOK['"]\s*,\s*true/.test(code));
// A broken leg (#1383) is the one thing that writes the gate, and only shut.
const limbsAt = code.indexOf('const brokenLimbs = (function (sp)');
const limbsEnd = code.indexOf('})(sp);', limbsAt);
const writesGate = (code.match(/setAnimationVariable\w*\(\s*['"]bSprintOK['"]/g) || []).length;
yes('the broken leg alone shuts bSprintOK, and only while the key is down',
  limbsAt > 0 && limbsEnd > limbsAt && writesGate === 1 &&
  /setAnimationVariableBool\('bSprintOK', false\)/.test(code.slice(limbsAt, limbsEnd)) &&
  /function holdSprintShut\(\) \{\s*if \(!sprintHeldSince \|\| !brokenLimbs\.leg\(\)\) \{ return; \}/.test(code));

// The jump and sprint block, from the probe hook to the end of its update handler.
const a = code.indexOf("ctx.storage.set('thornswoodProbe'");
const b = code.indexOf("guard('jump and sprint'");
const end = code.indexOf('}));', b);
yes('jump and sprint block found', a > 0 && b > a && end > b);
const block = code.slice(a, end);
const blockLimbsAt = block.indexOf('const brokenLimbs = (function (sp)');
const blockLimbsEnd = block.indexOf('})(sp);', blockLimbsAt);
const blockRest = blockLimbsAt >= 0 ? block.slice(0, blockLimbsAt) + block.slice(blockLimbsEnd) : block;
yes('the block writes no graph variable outside the broken leg', !/setAnimationVariable/.test(blockRest));
yes('the block does not touch AI driven', !/setPlayerAIDriven/.test(block));
yes('the probe still reads IsNPC', /ask\('IsNPC'/.test(block));
yes('the probe still reads bSprintOK', /ask\('bSprintOK'/.test(block));
yes('presses are still recorded', /probePresses\.push\(/.test(code));
yes('the character is fetched only for a press',
    /if \(probePresses\.length\) \{\s*try \{ pc = sp\.Game\.getPlayer\(\);/.test(code));
// The stuck rescue that switched AI-driven off is gone with the controls
// watchdog (#2620): nothing in the game turns AI-driven on, so nothing calls it.
yes('nothing in the front plugin calls setPlayerAIDriven',
    !/setPlayerAIDriven\(/.test(code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
