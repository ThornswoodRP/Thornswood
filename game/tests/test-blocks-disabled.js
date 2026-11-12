// test-blocks-disabled.js
//
// The server holds the three chopping blocks at Djinn's points disabled, and
// the client reads the flag by the name the server sends it. Issue #495.
//
// The server wrote a reference's disabled flag as "isDisabled" and the client
// read "disabled", so a reference the server held disabled was never disabled
// on anybody's machine, and one a plugin had disabled was enabled again on
// every stream. That is why thornswood-front.js had to take the three blocks
// out again every four seconds. Fork a922b480 reads "isDisabled"; the
// gamemode now disables the three on the server at start.
//
// Drives the real disableBlocksOff out of game/gamemode.js against a fake mp,
// and reads the client source in engine/skymp for the name it reads. Read
// only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const GM = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const src = fs.readFileSync(GM, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const a = src.indexOf('const BLOCKS_OFF_REFS = [');
const b = a < 0 ? -1 : src.indexOf('\ndisableBlocksOff();\n', a);
yes('the gamemode has BLOCKS_OFF_REFS and disableBlocksOff', a >= 0 && b > a);
yes('and calls it once at load', b > a && (src.match(/^disableBlocksOff\(\);$/mg) || []).length === 1);

if (a >= 0 && b > a) {
  const text = src.slice(a, b);
  const IDS = { 'd6ae9:Skyrim.esm': 0xd6ae9, 'a9ee1:Skyrim.esm': 0xa9ee1, 'abf83:Skyrim.esm': 0xabf83 };
  function world(opts) {
    opts = opts || {};
    const disabled = {}, logs = [], sets = [];
    (opts.already || []).forEach(function (id) { disabled[id] = true; });
    const mp = {
      get: function (id, key) { if (opts.throwOn === id) { throw new Error('no such form'); } return key === 'isDisabled' ? !!disabled[id] : undefined; },
      set: function (id, key, v) { sets.push([id, key, v]); if (key === 'isDisabled') { disabled[id] = !!v; } }
    };
    const idOf = function (d) { return opts.missing === d ? 0 : (IDS[d] || 0); };
    const log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
    const fn = new Function('mp', 'idOf', 'log', text + '\nreturn { disableBlocksOff: disableBlocksOff, BLOCKS_OFF_REFS: BLOCKS_OFF_REFS };');
    const api = fn(mp, idOf, log);
    return { api: api, disabled: disabled, logs: logs, sets: sets };
  }

  const w = world();
  yes('the three are the measured references (d6ae9, a9ee1, abf83 in Skyrim.esm)',
      JSON.stringify(w.api.BLOCKS_OFF_REFS) === JSON.stringify(['d6ae9:Skyrim.esm', 'a9ee1:Skyrim.esm', 'abf83:Skyrim.esm']));
  const took = w.api.disableBlocksOff();
  yes('all three are disabled on the server', took === 3 && w.disabled[0xd6ae9] && w.disabled[0xa9ee1] && w.disabled[0xabf83]);
  yes('through the isDisabled property', w.sets.every(function (s) { return s[1] === 'isDisabled' && s[2] === true; }));
  yes('and it says so in the log', w.logs.some(function (l) { return /holds 3 chopping block/.test(l); }));

  const again = world({ already: [0xd6ae9, 0xa9ee1, 0xabf83] });
  yes('a start where they are already disabled writes nothing and says nothing',
      again.api.disableBlocksOff() === 0 && again.sets.length === 0 && again.logs.length === 0);

  const gone = world({ missing: 'a9ee1:Skyrim.esm' });
  yes('a reference not in the load order is left alone and named', gone.api.disableBlocksOff() === 2 &&
      !gone.disabled[0xa9ee1] && gone.logs.some(function (l) { return /a9ee1:Skyrim\.esm is not in this load order/.test(l); }));

  const bad = world({ throwOn: 0xd6ae9 });
  let threw = false, n = -1;
  try { n = bad.api.disableBlocksOff(); } catch (e) { threw = true; }
  yes('one that throws does not stop the others or the gamemode', !threw && n === 2 &&
      bad.logs.some(function (l) { return /could not hold chopping block d6ae9/.test(l); }));
}

// ---- the client reads the name the server sends -----------------------------
const ENGINE = process.env.ENGINE || path.join(ROOT, 'engine', 'skymp');
const rs = path.join(ENGINE, 'skymp5-client', 'src', 'services', 'services', 'remoteServer.ts');
const hdr = path.join(ENGINE, 'skymp5-server', 'cpp', 'messages', 'CreateActorMessage.h');
if (fs.existsSync(rs) && fs.existsSync(hdr)) {
  const client = fs.readFileSync(rs, 'utf8');
  const server = fs.readFileSync(hdr, 'utf8');
  const sent = (/\.Serialize\("([A-Za-z]*[Dd]isabled)"/.exec(server) || [])[1];
  yes('the server sends the flag as isDisabled', sent === 'isDisabled');
  yes('the client reads isDisabled when an object arrives', /applyModelIsDisabled\(refr, !!\(msg\.props\['isDisabled'\]/.test(client));
  yes('and in a property update', /msg\.propName === 'isDisabled'/.test(client));
} else {
  console.log('SKIP  the engine source is not here (git submodule update --init engine/skymp)');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
