// #2261: a tome refused under the Mage rules goes back into the reader's pack
// on screen. The server kept it (onReadBook false), but the client had already
// taken it out locally, so the reader saw it consumed.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'gamemode.js'), 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } }

const a = src.indexOf("mp.onReadBook = guard('onReadBook'");
const b = src.indexOf('\n});', a);
yes('onReadBook is in the gamemode', a >= 0 && b > a);
const block = src.slice(a, b + 4);

function rig(answer) {
  const sets = [], timers = [], told = [];
  const pack = { entries: [{ baseId: 0xa26f3, count: 1 }] };
  const mp = {
    get: (id, k) => (k === 'inventory' ? pack : null),
    set: (id, k, v) => { sets.push([id, k, v]); }
  };
  const g = { __thornswoodTomes: { read: () => answer } };
  const fn = new Function('mp', 'globalThis', 'guard', 'notify', 'say', 'setTimeout',
    block + '\nreturn mp.onReadBook;');
  const handler = fn(mp, g, (n, f) => f, (id, l) => told.push(l), () => {}, (f, ms) => timers.push([f, ms]));
  return { handler, sets, timers, told, pack };
}

{
  const r = rig({ refused: true, line: 'You cannot learn Fireball: no spell point. You keep the tome.' });
  const out = r.handler(0x14, 0xa26f3);
  yes('a refused tome is refused to the engine (false)', out === false);
  yes('the reader is told why', r.told.length === 1);
  yes('their pack is sent back as the server has it, tome included',
      r.sets.some(s => s[0] === 0x14 && s[1] === 'inventory' && s[2] === r.pack));
  yes('and once more after the client has finished its own read', r.timers.length === 1);
  r.timers.forEach(t => t[0]());
  yes('which sends the pack again', r.sets.filter(s => s[1] === 'inventory').length === 2);
}
{
  const r = rig({ refused: false, line: 'The tome teaches you Flames.' });
  const out = r.handler(0x14, 0xa26f3);
  yes('a learned tome is not refused (the engine spends it)', out !== false);
  yes('and the pack is not resent', r.sets.length === 0 && r.timers.length === 0);
}
{
  const r = rig(null);
  yes('an ordinary book is left alone', r.handler(0x14, 0x1) !== false && r.sets.length === 0);
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
