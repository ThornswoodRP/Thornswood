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
  a send or an edit. Since 26 Nov 2026 a post is edited where it stands and
  one already right is asked nothing (#6891), and it holds:

    1. with every write taken, the words are edited in place, nothing is
       sent or taken down, a person's message and the Member reaction post
       are left alone, and a second run changes nothing;
    2. a refused second edit is named, part old and part new, and does not
       stop the build;
    3. a refused first edit leaves the old words whole and is named;
    4. words that need more posts send the extra ones first: a refused send
       leaves the old words whole and unedited, what did go is taken back,
       and one that cannot be is named by its id;
    5. old posts that cannot be read: nothing is sent or edited (#2736);
    6. words that need fewer posts take the rest down, and say one that
       will not come down;
    7. the run goes on to the next channel and writes it;
    8 to 10. a discussion guide is edited in place, split into pinned parts
       within Discord's limits, and a refused send or pin is said.

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
