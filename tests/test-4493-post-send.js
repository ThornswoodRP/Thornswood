'use strict';
/*
  test-4493-post-send.js

      node tests/test-4493-post-send.js

  Issue #4493. A -Posts build of the Discord (bot/Build-Discord.py, post)
  took the bot's old words out of a read only channel first and then sent
  the new ones with nothing to catch a refused send. One refused send left
  the channel empty or half written, escaped write_posts and on_ready, and
  ended the run: every channel after it, and the welcome and notice
  settings, were skipped, and nothing named the channel left empty.

  This runs tests/post-send-cases.py, which lifts post and write_posts out
  of Build-Discord.py and runs them against a stand-in channel that refuses
  a send, and holds:

    1. with every send taken, the new words go in before the old come out,
       and a person's message and the Member reaction post are left alone;
    2. a refused second send leaves the old words whole, takes back the half
       sent, names the channel, and does not stop the build;
    3. so does a refused first send;
    4. a half sent that cannot be taken back is named too;
    5. old posts that cannot be read: nothing is sent (#2736);
    6. old posts that will not delete after the new are in: said;
    7. the run goes on to the next channel and writes it.

  bot/tests need discord.py and run only in the nightly (#5958), so this is
  here, where every pull request runs it. Needs a Python, any 3; not the
  bot's libraries. Never connects to anything.
*/
const path = require('path');
const { spawnSync } = require('child_process');
const CASES = path.join(__dirname, 'post-send-cases.py');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (!p.error) { return p; }
  }
  return null;
}

const run = python([CASES]);
if (run) { process.stdout.write(String(run.stdout || '').split('\n').map((l) => (l ? '      ' + l : l)).join('\n')); }
yes('the post send cases pass (python tests/post-send-cases.py)', !!run && run.status === 0);
if (!run) { console.log('      no python here'); }
else if (run.status !== 0 && run.stderr) { console.log(run.stderr); }

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
