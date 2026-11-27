// test-6724-close-says-goodbye.js
//
// Closing the game tells the game server it has left (#6724).
//
// On main on 24 Nov a game closed from the character choice page and the
// same account picked again 1 to 3 s later, three times, and was turned away
// as a second game: win32.exitProcess ended the process without closing the
// connection, so the server held the old game for its own 60 s timeout.
// closeGame now puts the client down first (destroyClient), whose shutdown
// says goodbye to the server (fork #204), and only then exits.
//
// Runs the real closeGame out of game/plugins/thornswood-front.js over a
// stand-in sp. Read only.
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

const m = /  function closeGame\(from\) \{[\s\S]*?\n  \}\n/.exec(front);
yes('closeGame is in the front plugin', !!m);

function rig(opts) {
  const did = [];
  const lines = [];
  const sp = {
    browser: { setFocused() {}, setVisible() {} },
    mpClientPlugin: {
      destroyClient() { did.push('destroyClient'); if (opts.destroyThrows) { throw new Error('no'); } }
    },
    Debug: { quitGame() { did.push('quitGame'); throw new Error('not from a tick'); } }
  };
  if (!opts.noWin32) { sp.win32 = { exitProcess() { did.push('exitProcess'); } }; }
  const T = { js() {} };
  const state = { closingGame: false };
  const f = new Function('sp', 'T', 'log', 'state',
    'let closingGame = false;\n' + m[0] + '\nreturn function (from) { closeGame(from); state.closingGame = closingGame; };')(
    sp, T, function () { lines.push(Array.prototype.join.call(arguments, ' ')); }, state);
  f('the character choice page');
  return { did, lines, state };
}

if (m) {
  const r = rig({});
  yes('the connection is closed before the game exits',
      r.did.join(',') === 'destroyClient,exitProcess');
  yes('it says it closed the connection', r.lines.some(l => /closed the connection to the game server/.test(l)));
  yes('it still says it asked the engine to exit', r.lines.some(l => /asked the engine to exit/.test(l)));

  const t = rig({ destroyThrows: true });
  yes('a connection that will not close still lets the game exit',
      t.did.join(',') === 'destroyClient,exitProcess' &&
      t.lines.some(l => /could not close the connection to the game server/.test(l)));

  const o = rig({ noWin32: true });
  yes('a game with no exitProcess keeps its connection, since it may stay open',
      o.did.indexOf('destroyClient') === -1 && o.state.closingGame === false);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
