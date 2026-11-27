// test-engine-at-fork-head.js
//
//     node tests\test-engine-at-fork-head.js
//
// The engine the repository pins is the fork branch as it stands (issue
// #1200). tests\test-one-engine.js holds the pin and the two build records to
// one commit; this holds that commit to the head of the branch .gitmodules
// follows, so a change merged into the fork and never pinned here shows up the
// next night instead of sitting unused. Patrick, 29 Sep: "we should always be
// using the new one ... What's the point in the changes if we aren't using
// them."
//
// It asks the fork itself, over git (tests\fork-git.js, #3052), for the pin
// against the branch, and judges the answer:
//   identical                       the pin is the head: pass
//   ahead, no file differs          the head is only merge commits over the
//                                   pin (a fork pull request merged with a
//                                   merge commit): the same source, pass
//   ahead, with files               fork changes nobody here runs yet: fail,
//                                   naming the commits
//   behind or diverged              the pin is not on the branch: fail
// It asked GitHub's REST compare API signed out until 21 Oct, which allows 60
// requests an hour per address and failed on every shared one (a cloud
// thread); git's own fetch is not under that limit and needs no token.
// No answer from the fork is a fail, not a skip: a check that did not happen
// is the failure this exists to stop. It needs the network, so it runs in the
// nightly checks and not in the build check on every pull request.
//
// THORNSWOOD_FORK_COMPARE_JSON, a path to a saved comparison in the same
// shape (status, ahead_by, behind_by, commits, files), stands in for the
// network so the verdict can be checked by hand. Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const forkGit = require('./fork-git');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function git(args) {
  return execFileSync('git', ['-C', REPO].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// What a compare answer says about the pin, as { ok, why }.
function verdict(cmp) {
  if (!cmp || typeof cmp.status !== 'string') { return { ok: false, why: 'no comparison was made' }; }
  const commits = Array.isArray(cmp.commits) ? cmp.commits : [];
  const files = Array.isArray(cmp.files) ? cmp.files : [];
  if (cmp.status === 'identical') { return { ok: true, why: 'the pin is the head of the branch' }; }
  if (cmp.status === 'ahead' && files.length === 0) {
    return { ok: true, why: 'the head is ' + cmp.ahead_by + ' merge commit(s) over the pin with the same files' };
  }
  if (cmp.status === 'ahead') {
    const names = commits.map(function (c) { return String(c.sha || '').slice(0, 8) + ' ' + String((c.commit && c.commit.message) || '').split('\n')[0]; });
    return { ok: false, why: cmp.ahead_by + ' fork commit(s) changing ' + files.length + ' file(s) are on the branch and not in the pin: ' + names.join('; ') };
  }
  return { ok: false, why: 'the pin is not on the branch (' + cmp.status + ', ' + cmp.behind_by + ' commit(s) of the pin are not on it)' };
}

// The verdict itself, on made up answers.
yes('identical passes', verdict({ status: 'identical', ahead_by: 0, behind_by: 0, commits: [], files: [] }).ok);
yes('merge commits over the pin with no file changed pass', verdict({ status: 'ahead', ahead_by: 1, behind_by: 0, commits: [{ sha: 'aa' }], files: [] }).ok);
yes('a fork change not pinned fails', !verdict({ status: 'ahead', ahead_by: 2, behind_by: 0, commits: [{ sha: 'abcdef0123', commit: { message: 'A fix' } }], files: [{ filename: 'x.cpp' }] }).ok);
yes('a pin off the branch fails', !verdict({ status: 'diverged', ahead_by: 1, behind_by: 1, commits: [], files: [] }).ok);
yes('a pin ahead of the branch fails', !verdict({ status: 'behind', ahead_by: 0, behind_by: 1, commits: [], files: [] }).ok);
yes('no answer fails', !verdict(null).ok);

// The pin against the head of the branch in the fork, as git sees it. The
// files are named only when the head is ahead, the one case the verdict reads
// them; the head's tree being the pin's is the same as no file differing.
function askFork(url, branch, pin) {
  const repo = forkGit.open('fork-head');
  try {
    repo.fetch('fork', url, ['+refs/heads/' + branch + ':refs/compare/head']);
    try { repo.git(['fetch', '-q', '--no-tags', '--filter=tree:0', 'fork', pin]); }
    catch (e) { throw new Error('the fork does not have the pinned commit ' + pin + ' (' + e.message + ')'); }
    const cmp = repo.compare(pin, 'refs/compare/head');
    cmp.files = [];
    if (cmp.status === 'ahead' && repo.git(['log', '-1', '--format=%T', pin]) !== repo.git(['log', '-1', '--format=%T', 'refs/compare/head'])) {
      cmp.files = repo.git(['diff', '--name-only', pin, 'refs/compare/head']).split(/\r?\n/).filter(Boolean).map(function (f) { return { filename: f }; });
    }
    return cmp;
  } finally { repo.close(); }
}

async function main() {
  let pin = '', url = '', branch = '';
  try {
    const m = /^160000 commit ([0-9a-f]{40})\tengine\/skymp$/.exec(git(['ls-tree', 'HEAD', 'engine/skymp']));
    pin = m ? m[1] : '';
    url = git(['config', '-f', '.gitmodules', '--get', 'submodule.engine/skymp.url']);
    branch = git(['config', '-f', '.gitmodules', '--get', 'submodule.engine/skymp.branch']);
  } catch (e) { /* each is checked below */ }
  yes('HEAD pins engine/skymp to a commit' + (pin ? ' (' + pin.slice(0, 8) + ')' : ''), !!pin);
  const gh = /github\.com[/:]([^/]+)\/([^/]+?)(\.git)?\/?$/.exec(url);
  yes('.gitmodules names a GitHub fork and a branch (' + url + ', ' + branch + ')', !!(gh && branch));
  if (!pin || !gh || !branch) { return; }

  let cmp = null;
  const saved = process.env.THORNSWOOD_FORK_COMPARE_JSON;
  try {
    cmp = saved ? JSON.parse(fs.readFileSync(saved, 'utf8'))
      : askFork(url, branch, pin);
  } catch (e) {
    console.log('      ' + (e && e.message || e));
    cmp = null;
  }
  const v = verdict(cmp);
  console.log('      ' + v.why);
  yes('the pin is the head of ' + branch + ' in the fork', v.ok);
  if (!v.ok && cmp) {
    console.log('');
    console.log('  Pin the head of the branch and rebuild both halves from it (engine/README.md,');
    console.log('  "One engine"), or say on the board why a fork change is not to run yet.');
  }
}

main().then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}).catch(function (e) {
  console.log('FAIL  ' + String(e && e.stack || e).replace(/\n/g, '\n      '));
  process.exitCode = 1;
});
