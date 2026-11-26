'use strict';
/*
  test-4492-forum-swap.js

      node tests/test-4492-forum-swap.js

  Issue #4492. Once Community is on, a -Prune build of the Discord
  (bot/Apply-Discord.py, ensure_channel) found #bugs, #character-introductions
  and #tales still the text channels they were made as before Community,
  deleted each one and then made a forum in its place. It never asked whether
  anything was in them, though the prune list for channels the plan no longer
  has leaves a channel while a thread is open in it, and it deleted first, so
  a forum Discord refused left the channel gone.

  This runs tests/forum-swap-cases.py, which lifts the build's code out of
  Apply-Discord.py and runs it against a stand-in guild, and holds:

    1. an empty text channel where the plan wants a forum is rebuilt, the
       forum made before the text channel is deleted;
    2. one holding messages is left, and named with why;
    3. one with a thread open in it is left, and named with why;
    4. when Discord refuses the forum, the text channel is still there;
    5. when the old channel will not delete, the forum made stays, and that
       is said;
    6. when Discord will not list the threads or the messages, nothing goes;
    7. -Prune -Check, a build without -Prune, and a name in KEEP change
       nothing;
    8. the swap and the prune list go through one check, why_kept: the
       prune list's channels the plan retired still go once no thread is open
       in them, as before.

  Needs a Python, any 3; not the bot's libraries. Never connects to anything.
*/
const path = require('path');
const { spawnSync } = require('child_process');
const CASES = path.join(__dirname, 'forum-swap-cases.py');

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
yes('the forum swap cases pass (python tests/forum-swap-cases.py)', !!run && run.status === 0);
if (!run) { console.log('      no python here'); }
else if (run.status !== 0 && run.stderr) { console.log(run.stderr); }

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
