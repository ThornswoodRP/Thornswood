// tests/test-6036-process-exit.js
//
//     node tests/test-6036-process-exit.js
//
// No new call to node's exit function, and none left in game/tests or the
// harnesses Tree checks runs (#6036).
//
// WHY. On Node 24 that call can deadlock with V8's background compiler
// threads (nodejs/node#64274): the harness prints its result and node never
// ends. On 16 Nov 2026 game/tests/test-other-server-name-gone.js did that in
// Tree checks five times and took five pull requests out of the merge queue.
// scripts/dev/Check-ProcessExit.js holds the count to
// scripts/dev/exit-baseline.txt, which only goes down.
//
// HOW.
//   1. The real checkout against the real baseline: nothing above it, nothing
//      below it with its line not lowered, each problem on a FAIL line of
//      its own.
//   2. game/tests and the three harnesses Tree checks runs on their own steps
//      (tests/gate-excluded.txt) call it nowhere, and the baseline names none
//      of them, so they cannot come back by raising a line.
//   3. The check against a scratch repository: a new call, a call in a new
//      file nobody has committed, a raised count, a lowered count, a file
//      that has none left, and a baseline line it cannot read are each a
//      problem; a tree that matches its baseline is none.
// Offline. Every scratch folder is removed.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const REPO = path.join(__dirname, '..');
const check = require(path.join(REPO, 'scripts', 'dev', 'Check-ProcessExit.js'));
const CALL = check.CALL;

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

// ---- 1. the real checkout
const have = check.measure(REPO);
const base = check.readBaseline(path.join(REPO, check.BASELINE));
const problems = base.bad.concat(check.compare(have, base.allowed));
problems.forEach((p) => console.log('FAIL  ' + p.replace(/ time\(s\), and the baseline allows (\d+)\..*$/, ' (allows $1)')));
yes('the checkout matches ' + check.BASELINE + ' (' + problems.length + ' problem(s))', problems.length === 0);
if (problems.length) console.log('      node scripts/dev/Check-ProcessExit.js --list prints today\'s numbers in the baseline\'s format');

// ---- 2. game/tests and what Tree checks runs
const TREE_CHECKS = ['game/tests/test-other-server-name-gone.js', 'tests/test-old-name-gone.js', 'tests/test-one-engine.js'];
const inGame = Array.from(have.keys()).filter((f) => f.startsWith('game/tests/'));
yes('no harness in game/tests calls it (' + inGame.length + ')', inGame.length === 0);
const inTree = TREE_CHECKS.filter((f) => have.has(f));
yes('nor do the harnesses Tree checks runs on their own steps (' + inTree.join(', ') + ')', inTree.length === 0);
const listed = Array.from(base.allowed.keys()).filter((f) => f.startsWith('game/tests/') || TREE_CHECKS.includes(f));
yes('and the baseline names none of them (' + listed.join(', ') + ')', listed.length === 0);
const ws = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'build.yml'), 'utf8');
yes('those three are the node harnesses build.yml runs on steps of their own', TREE_CHECKS.every((f) => ws.includes('node ' + f)));
yes('the check and this harness end by setting process.exitCode',
  check.count(fs.readFileSync(path.join(REPO, 'scripts', 'dev', 'Check-ProcessExit.js'), 'utf8')) === 0 &&
  check.count(fs.readFileSync(__filename, 'utf8')) === 0);

// ---- 3. the check itself, on a scratch repository
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-6036-'));
try {
  const git = (args) => cp.spawnSync('git', ['-C', tmp].concat(args), { encoding: 'utf8' });
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), text); };
  yes('a scratch repository is made', git(['init', '-q']).status === 0);
  put('a.js', 'console.log(1);\n' + CALL + '0);\n');
  put('b.ps1', "node -e \"" + CALL + "1)\"\n");
  put('c.txt', CALL + '0);\n');
  put('d.js', 'process.exitCode = 0;\n');
  git(['add', '-A']);
  const run = (baseline) => {
    put('base.txt', baseline);
    const b = check.readBaseline(path.join(tmp, 'base.txt'));
    return b.bad.concat(check.compare(check.measure(tmp), b.allowed));
  };
  let p = run('# a comment\na.js 1\nb.ps1 1\n');
  yes('a tree that matches its baseline is no problem; a .txt file and process.exitCode are not counted', p.length === 0);
  put('e.js', CALL + '1);\n');
  p = run('a.js 1\nb.ps1 1\n');
  yes('a call in a new file nobody has committed yet is one', p.length === 1 && /^e\.js calls it 1 time\(s\), and the baseline allows 0/.test(p[0]));
  fs.unlinkSync(path.join(tmp, 'e.js'));
  put('a.js', CALL + '0); ' + CALL + '1);\n');
  p = run('a.js 1\nb.ps1 1\n');
  yes('a second call in a listed file is one', p.length === 1 && /^a\.js calls it 2 time\(s\), and the baseline allows 1/.test(p[0]));
  put('a.js', 'process.exitCode = 0;\n');
  p = run('a.js 1\nb.ps1 1\n');
  yes('a file with none left whose line is still there is one', p.length === 1 && /^a\.js calls it no more/.test(p[0]));
  put('b.ps1', "node -e \"" + CALL + "1)\"; node -e \"" + CALL + "2)\"\n");
  p = run('b.ps1 3\n');
  yes('a count below its line is one, naming the number to lower it to', p.length === 1 && /^b\.ps1 calls it 2 time\(s\), and its line says 3\. Lower the line to 2/.test(p[0]));
  p = run('b.ps1 2\nb.ps1 2\nnot a line\nz.js 0\n');
  yes('a line twice, a line that is not a path and a count, and a count of 0 are each one', p.filter((x) => /is not one path and a count/.test(x)).length === 3);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
yes('the scratch repository is gone', !fs.existsSync(tmp));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
