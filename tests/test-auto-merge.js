// Every open pull request goes on auto-merge, and one the merge queue let go
// for a reason not its own goes back (Patrick, 2 Nov 2026: "every PR goes on
// auto-merge when it opens, dropped PRs go back in the queue").
// scripts/ops/Auto-Merge.js is the rule and .github/workflows/auto-merge.yml
// runs it. Offline: the script against a stand-in GitHub, and the workflow
// read from its file. Nothing reaches GitHub.
//
// What is held here:
//   1. the rule: a ready pull request goes on; a draft, another
//      repository's, a hands-off person's, one already on or in the queue,
//      one that conflicts with main, and one aimed elsewhere stay off;
//   2. a drop: one the queue let go at its current commit (no commit or
//      force push after the drop) for a failed check, a conflict, by hand
//      or for no reason given stays its owner's,
//      and a push after it puts it back; one let go because the queue was
//      cleared, rolled back or timed out goes back now;
//   3. the sweep: every page is read, a dry run turns nothing on, and a
//      refusal from GitHub is said and makes the run red;
//   4. the wiring: after every pull request build, on every push to main and
//      by hand, from main's own script with no credential kept, with the pin
//      robot's App token from the engine-pin environment, never the run's
//      own (a queue entry the run's token makes starts no checks).
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const A = require(path.join(REPO, 'scripts', 'ops', 'Auto-Merge.js'));
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }
function read(f) { try { return fs.readFileSync(path.join(REPO, f), 'utf8').split('\r\n').join('\n'); } catch (e) { return ''; } }

function pr(n, more) {
  return Object.assign({ id: 'PR_' + n, number: n, isDraft: false, isCrossRepository: false, baseRefName: 'main', headRefOid: 'h' + n,
    mergeable: 'MERGEABLE', isInMergeQueue: false, author: { login: 'EvilPatrick06' }, autoMergeRequest: null, timelineItems: { nodes: [] } }, more || {});
}
// The newest of a pull request's drops, commits and force pushes, as the query
// asks for it: a drop, or (pushed after one) a commit or a force push.
function dropped(n, reason) { return pr(n, { timelineItems: { nodes: [{ __typename: 'RemovedFromMergeQueueEvent', createdAt: '2026-11-02T20:00:00Z', reason }] } }); }
function pushedAfter(n, kind) { return pr(n, { timelineItems: { nodes: [{ __typename: kind }] } }); }
const on = (p) => A.judge(p, 'main')[0];

// ---- 1. the rule
yes('1 an open, ready pull request goes on', on(pr(1)));
yes('  and so do a Bot\'s and Dependabot\'s', on(pr(2, { author: { login: 'thornswood-workers' } })) && on(pr(3, { author: { login: 'dependabot' } })));
yes('1 a draft stays off', !on(pr(4, { isDraft: true })));
yes('1 one from another repository stays off', !on(pr(5, { isCrossRepository: true })));
yes('1 Djinn\'s and Jhinswife\'s stay off, their work is hands off', !on(pr(6, { author: { login: 'WiccanDjinn' } })) && !on(pr(7, { author: { login: 'Jhinswife' } })));
yes('1 one already on auto-merge or in the queue is left as it is', !on(pr(8, { autoMergeRequest: { enabledAt: 'x' } })) && !on(pr(9, { isInMergeQueue: true })));
yes('1 one that conflicts with main stays off, and says its owner brings main in', !on(pr(10, { mergeable: 'CONFLICTING' })) && /brings main in/.test(A.judge(pr(10, { mergeable: 'CONFLICTING' }), 'main')[1]));
yes('1 one GitHub has not worked out yet goes on (the queue holds it to main anyway)', on(pr(11, { mergeable: 'UNKNOWN' })));
yes('1 one aimed at another branch stays off', !on(pr(12, { baseRefName: 'claude/stack' })));

// ---- 2. a drop
for (const r of ['CI_FAILURE', 'MERGE_CONFLICT', 'INVALID_MERGE_COMMIT', 'GIT_TREE_INVALID', 'MANUAL', 'UNKNOWN_REMOVAL_REASON', '']) {
  yes('2 let go at this commit for ' + (r || 'no reason given') + ': its owner\'s, it stays off', !on(dropped(20, r)));
}
yes('  and says a push with the fix puts it back', /a push with the fix puts it back/.test(A.judge(dropped(20, 'CI_FAILURE'), 'main')[1]));
yes('2 let go for a failed check, then pushed again: back on', on(pushedAfter(21, 'PullRequestCommit')) && on(pushedAfter(21, 'HeadRefForcePushedEvent')));
yes('2 the query asks for the newest of its drops, commits and force pushes, not the drop\'s own commit (#5470)',
  /timelineItems\(last: 1, itemTypes: \[REMOVED_FROM_MERGE_QUEUE_EVENT, PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT\]\)/.test(A.QUERY) &&
  /__typename/.test(A.QUERY) && !/beforeCommit/.test(A.QUERY));
for (const r of ['QUEUE_CLEARED', 'ROLL_BACK', 'CI_TIMEOUT', 'BRANCH_PROTECTIONS', 'UNREACHABLE']) {
  yes('2 let go for ' + r + ', not its own doing: back on now', on(dropped(22, r)));
}

// ---- 3. the sweep
function fake(pages, refuse) {
  const calls = [];
  const gql = async (q, v) => {
    calls.push({ q, v });
    if (q === A.QUERY) {
      const i = v.after ? Number(v.after) : 0;
      return { repository: { pullRequests: { nodes: pages[i], pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: String(i + 1) } } } };
    }
    if (q === A.ENABLE) {
      if (refuse && refuse.indexOf(v.id) >= 0) throw new Error('Pull request is in clean status');
      return { enablePullRequestAutoMerge: { pullRequest: { number: 0, autoMergeRequest: { enabledAt: 'now' } } } };
    }
    throw new Error('not in the stand-in');
  };
  return { gql, calls, enabled: () => calls.filter(c => c.q === A.ENABLE).map(c => c.v.id) };
}
(async () => {
  let f = fake([[pr(1), pr(2, { isDraft: true })], [dropped(3, 'CI_FAILURE'), dropped(4, 'QUEUE_CLEARED')]]);
  let said = [];
  let code = await A.sweep('ThornswoodRP/Thornswood', f.gql, (l) => said.push(l));
  yes('3 every page is read, and the ready ones go on (' + f.enabled().join(', ') + ')', code === 0 && JSON.stringify(f.enabled()) === '["PR_1","PR_4"]');
  yes('  each one left is said with why', said.some(l => /^#2 left: a draft$/.test(l)) && said.some(l => /^#3 left: the queue let it go at this commit \(CI_FAILURE\)/.test(l)));
  yes('  and squash, as the guide says (gh pr merge --auto --squash)', /mergeMethod: SQUASH/.test(A.ENABLE));
  f = fake([[pr(1), pr(5)]]);
  said = [];
  code = await A.sweep('ThornswoodRP/Thornswood', f.gql, (l) => said.push(l), { dryRun: true });
  yes('3 a dry run turns nothing on and says what it would', code === 0 && f.enabled().length === 0 && said.filter(l => /would go on auto-merge/.test(l)).length === 2);
  f = fake([[pr(1), pr(6)]], ['PR_1']);
  said = [];
  code = await A.sweep('ThornswoodRP/Thornswood', f.gql, (l) => said.push(l));
  yes('3 a refusal from GitHub is said as given, the rest still go on, and the run is red', code === 1 && said.some(l => /^#1 refused by GitHub: Pull request is in clean status$/.test(l)) && f.enabled().indexOf('PR_6') >= 0);

  // ---- 4. the wiring
  const wf = read('.github/workflows/auto-merge.yml');
  const code_ = wf.replace(/^\s*#.*$/gm, '');
  yes('4 the workflow is there', !!wf);
  yes('4 it runs after every pull request build, on every push to main and by hand, nothing else',
    /\non:\n  workflow_run:\n    workflows: \["Build check \(pull requests\)"\]\n    types: \[completed\]\n  push:\n    branches: \[main\]\n  workflow_dispatch:\npermissions: \{\}\n/.test(wf));
  yes('  the workflow it follows is named that', /\nname: Build check \(pull requests\)\n/.test(read('.github/workflows/build-pr.yml')));
  yes('4 it checks out main\'s scripts/ops with no credential kept, never a pull request\'s code',
    /\n        with:\n          ref: main\n          persist-credentials: false\n          sparse-checkout: scripts\/ops\n/.test(wf) && !/pull_request_target|head_sha|head_branch|github\.event\.pull_request/.test(code_));
  yes('4 it runs in the engine-pin environment, and the run\'s own token only reads',
    /\n    environment: engine-pin\n    permissions:\n      contents: read\n    steps:\n/.test(wf));
  yes('4 it mints the pin robot\'s token there, with contents and pull requests write, and reads no other secret',
    /\n      - name: The pin robot's token\n        id: app\n        uses: actions\/create-github-app-token@[0-9a-f]{40} # v\S+\n        with:\n          client-id: \$\{\{ vars\.PIN_APP_CLIENT_ID \}\}\n          private-key: \$\{\{ secrets\.PIN_APP_KEY \}\}\n          permission-contents: write\n          permission-pull-requests: write\n/.test(wf) &&
    (code_.match(/secrets\.\w+/g) || []).every(x => x === 'secrets.PIN_APP_KEY'));
  yes('4 it runs the script with the App\'s token, never the run\'s own (whose queue entries start no checks)',
    /\n        env:\n          GH_TOKEN: \$\{\{ steps\.app\.outputs\.token \}\}\n          REPO: \$\{\{ github\.repository \}\}\n        run: node scripts\/ops\/Auto-Merge\.js\n/.test(wf) && !/github\.token/.test(code_));
  yes('4 one at a time, the newest wins', /\nconcurrency:\n  group: auto-merge\n  cancel-in-progress: true\n/.test(wf));
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  ' + e.stack); process.exit(1); });
