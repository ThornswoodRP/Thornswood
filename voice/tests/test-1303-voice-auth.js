// test-1303-voice-auth.js
//
//     node voice\tests\test-1303-voice-auth.js
//
// #1303, #1315, #1337, #1322. Who the voice service lets in, and how a join
// token is carried, on every pull request.
//
// The voice harnesses beside the service (voice\test-*.js) run every night,
// not in Launcher builds. A change that let an unproven connection back in,
// minted a join token without the site's yes, answered a handshake that
// carried no token, or let one token open two connections would let a
// stranger into every conversation and onto the roster, and would sit on
// main until the next night. So this runs voice\tests\test-auth.js, which starts
// the real voice-server.js beside a small site of its own and drives /token
// and the handshake, and voice\tests\test-token-refresh.js, which runs the game's
// chat overlay and checks it spends a token on one try only. It fails with
// either. Nothing is copied out of them, so they cannot drift apart.
//
// Writes only to temp folders, through voice\tests\test-auth.js.
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function run(name, least) {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'voice', 'tests', name)],
    { encoding: 'utf8', timeout: 90000 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  console.log(out.split('\n').map((l) => '    ' + l).join('\n'));
  const m = /(\d+) passed, (\d+) failed/.exec(out);
  yes('voice\\' + name + ' ran to the end', !!m && !r.error);
  yes('and every check in it passed (' + (m ? m[1] + ' passed, ' + m[2] + ' failed' : 'no count') + ')',
      !!m && Number(m[2]) === 0 && Number(m[1]) >= least && r.status === 0);
  return out;
}

const auth = run('test-auth.js', 33);
yes('including the ones these issues are about: no unproven join, no token without the site (#1303, #1315)',
    /ok\s+no token at all: 403 before any socket/.test(auth) && /ok\s+a service with no THORNSWOOD_SITE mints nothing: 503/.test(auth) &&
    /ok\s+the site never answered: 503/.test(auth));
yes('a token at the handshake, once (#1337, #1322)',
    /ok\s+a real token opens the connection/.test(auth) &&
    /ok\s+the same token again, while its connection is still open, is refused: it was copied/.test(auth) &&
    /ok\s+a page that sends its token in the join message, as every page did before, never gets a socket/.test(auth));
const overlay = run('test-token-refresh.js', 13);
yes('and the game\'s chat spends a token on one try, and asks for the next (#1322)',
    /ok\s+with no token left, a try asks the front for one, for this character/.test(overlay) &&
    /ok\s+the token it already spent is not taken again/.test(overlay));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
