// test-1831-dead-waits.js
//
// #1831. #1413 put the seams on a deposit (twenty in a seam, one a swing, back
// for everybody at once) and the carcasses on the shared resource stock (one
// dressing a life). After that two waits were worked out and read by nothing:
// MINE_COOLDOWN_MS, the per person wait a seam used to refuse with, and the
// span loot() took off HUNT_TUNING.cooldownMs and never used. miner.md and
// hunter.md describe the deposit and the body that stands back up, not a wait
// by rank, so both came out, with the comments that still called them live.
//
// Reads game/gamemode.js; comments are taken out before the code is read, the
// way test-cooldown-sweep.js does, because comments here quote old code.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js'), 'utf8')
  .split(String.fromCharCode(13)).join('');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function fnBody(s, head) {
  const a = s.indexOf(head);
  if (a < 0) return null;
  const b = s.indexOf('\n}\n', a);
  return b < 0 ? null : s.slice(a, b + 3);
}

yes('MINE_COOLDOWN_MS is defined nowhere and read nowhere', !/\bMINE_COOLDOWN_MS\b/.test(code));
const mineOre = fnBody(code, 'function mineOre(');
yes('mineOre is there and keeps no per person wait', !!mineOre && !/cooldownLeft\(|stampCooldown\(|lastUse\./.test(mineOre));
yes('and it takes from the deposit', !!mineOre && /deposit/i.test(mineOre));

const hunt = (function () {
  const a = src.indexOf('const HUNT_TUNING = {');
  const b = a < 0 ? -1 : src.indexOf('\n};', a);
  return a < 0 || b < 0 ? null : src.slice(a, b + 3);
})();
let tuning = null;
try { tuning = hunt && new Function(hunt + '\nreturn HUNT_TUNING;')(); } catch (e) { tuning = null; }
yes('HUNT_TUNING holds bodySeconds and nothing else', !!tuning && Object.keys(tuning).join(',') === 'bodySeconds');
yes('and the body still lies five minutes', !!tuning && tuning.bodySeconds === 300);
yes('nothing reads HUNT_TUNING.cooldownMs', !/HUNT_TUNING\.cooldownMs/.test(code));
yes('mp.onDeath still writes bodySeconds onto an animal', /mp\.set\(actorId, 'spawnDelay', HUNT_TUNING\.bodySeconds\)/.test(code));

const loot = fnBody(code, 'function loot(');
yes('loot() is there and works out no span', !!loot && !/\bspan\b/.test(loot));
yes('and takes the body once a life on the shared stock', !!loot && /stock\.dress\(refrId,/.test(loot));

// the comments that described them as live
const live = src.split('\n').filter(function (l) {
  return /MINE_COOLDOWN_MS/.test(l) && !/until #1413|used to/i.test(l);
});
yes('no comment speaks of MINE_COOLDOWN_MS as a wait that is still kept' +
  (live.length ? ': ' + live.map(function (l) { return l.trim(); }).join(' | ') : ''), live.length === 0);
yes('the comment over cooldownLeft no longer sends a seam to it',
  src.indexOf('A seam passes its own off MINE_COOLDOWN_MS') < 0);
yes('the comment over HUNT_TUNING no longer argues a ladder of waits for a body',
  src.indexOf('cooldownMs, how long that hunter is done with that reference') < 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
