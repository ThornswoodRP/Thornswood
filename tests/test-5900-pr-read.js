'use strict';
/*
  test-5900-pr-read.js

      node tests/test-5900-pr-read.js

  Issue #5900. The required check "Test tasks in the pull request"
  (.github/workflows/test-tasks.yml, bot/pr_tasks.py) read the pull
  request's body back from GitHub on every run, though a pull_request run's
  own event already carries that body. When GitHub answered that read with a
  503, the check failed the pull request, and as the newest run of the check
  on the head it stood over an earlier run that had passed, with nothing in
  the pull request to answer.

  This runs tests/pr-read-cases.py, which drives pr_tasks.py's main() with
  GitHub answering 503, and holds:

    1. a pull_request run, first attempt, checks the body its event carries
       and never asks GitHub for the pull request, so a 503 there cannot
       fail it; a bad body in the event still fails it, and an empty one is
       an empty body;
    2. a re-run reads the body from GitHub, as it is now, because its event
       is its first attempt's and an edit since may have left it behind; a
       GitHub error there fails closed, saying nothing was checked;
    3. the merge queue and a run by hand, which carry no body, read it from
       GitHub and fail closed when they cannot;
    4. test-tasks.yml hands the event's body to the step in env, and never
       pastes it into the step's script.

  Needs a Python, any 3; not the bot's libraries. Never connects to anything.
*/
const path = require('path');
const { spawnSync } = require('child_process');
const CASES = path.join(__dirname, 'pr-read-cases.py');

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
yes('the pull request read cases pass (python tests/pr-read-cases.py)', !!run && run.status === 0);
if (!run) { console.log('      no python here'); }
else if (run.status !== 0 && run.stderr) { console.log(run.stderr); }

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
