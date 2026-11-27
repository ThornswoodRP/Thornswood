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
//   5. the two skips (Patrick's yes on Bramble's card, 2 Nov 2026): one that
//      changes what runs on the live box, or what a verb reads from main
//      such as the keys in scripts/vps/box-keys (#5726), or a script that
//      changes the box over ssh itself as records/remote-commands.json maps
//      it, Reset-Character.ps1 among them (#7443), stays off unless it is
//      Patrick's,
//      and a Bot's stays off until Bramble approved its head.
//   6. outside work (Patrick, 8 Nov 2026): one labelled 'outside work' stays
//      off whoever opened it, and the sweep asks GitHub for the labels.
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
    mergeable: 'MERGEABLE', isInMergeQueue: false, author: { login: 'EvilPatrick06' }, autoMergeRequest: null, timelineItems: { nodes: [] },
    headRefName: 'claude/x', paths: ['game/gamemode/a.ts'], reviews: { nodes: [] } }, more || {});
}
// The newest of a pull request's drops, commits and force pushes, as the query
// asks for it: a drop, or (pushed after one) a commit or a force push.
function dropped(n, reason) { return pr(n, { timelineItems: { nodes: [{ __typename: 'RemovedFromMergeQueueEvent', createdAt: '2026-11-02T20:00:00Z', reason }] } }); }
function pushedAfter(n, kind) { return pr(n, { timelineItems: { nodes: [{ __typename: kind }] } }); }
const on = (p) => A.judge(p, 'main')[0];

// ---- 1. the rule
yes('1 an open, ready pull request goes on', on(pr(1)));
yes('  and so does Dependabot\'s', on(pr(3, { author: { login: 'dependabot' }, headRefName: 'dependabot/npm_and_yarn/x' })));
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

// ---- 5. the two skips
const scripts = A.verbScripts(REPO);
const judge5 = (p) => A.judge(p, 'main', scripts);
const on5 = (p) => judge5(p)[0];
yes('5 the verb scripts are read from both of main\'s verb lists (' + scripts.length + ')',
  scripts.indexOf('scripts/ops/Reset-Npcs.ps1') >= 0 && scripts.indexOf('scripts/release/Send-NexusFile.ps1') >= 0 && scripts.indexOf('scripts/vps/gate/Update-Gate.ps1') >= 0);
const worker = { author: { login: 'thornswood-workers' }, headRefName: 'claude/y' };
for (const f of ['.github/workflows/build-pr.yml', 'scripts/vps/gate/GateRules.ps1', 'scripts/vps/gate/verbs.json', 'scripts/release/nexus-verbs.json', 'scripts/ops/Reset-Npcs.ps1']) {
  yes('5 one that changes ' + f + ', not Patrick\'s, stays off', !on5(pr(30, Object.assign({}, worker, { paths: ['README.md', f] }))));
}
// #5726: Grant-BoxKey puts on the box the key main carries in
// scripts/vps/box-keys/, so a change there is held like the script.
yes('5 the verb lists\' reads are read too: Grant-BoxKey reads scripts/vps/box-keys/', scripts.indexOf('scripts/vps/box-keys/') >= 0);
for (const f of ['scripts/vps/box-keys/oracle-hermes.json', 'scripts/vps/box-keys/somebody-new.json', 'scripts/vps/box-keys/README.md']) {
  yes('5 one that changes only ' + f + ', not Patrick\'s, stays off', !on5(pr(35, Object.assign({}, worker, { paths: [f] }))));
}
yes('  a robot\'s that adds a key stays off too', !on5(pr(36, { author: { login: 'thornswood-pin-robot' }, headRefName: 'engine-pin/next', paths: ['scripts/vps/box-keys/x.json'] })));
yes('  Patrick\'s that adds a key goes on', on5(pr(37, { headRefName: 'patrick-keys', paths: ['scripts/vps/box-keys/x.json'] })));
yes('  a folder entry holds only what is under it', A.boxFiles(['scripts/vps/box-keys-notes.md', 'scripts/vps/box-keys/a.json'], ['scripts/vps/box-keys/']).join(' ') === 'scripts/vps/box-keys/a.json');
yes('  and says it changes what runs on the live box, naming the file', /changes what runs on the live box \(\.github\/workflows\/build-pr\.yml\)/.test(judge5(pr(30, Object.assign({}, worker, { paths: ['.github/workflows/build-pr.yml'] })))[1]));
yes('  Dependabot\'s workflow bump stays off too', !on5(pr(31, { author: { login: 'dependabot' }, headRefName: 'dependabot/github_actions/x', paths: ['.github/workflows/build.yml'] })));
// #7443: a script that changes the box over ssh outside the gate verbs, as
// records/remote-commands.json maps it, is held like a verb's script.
const held = A.boxScripts(REPO);
const remote = A.remoteScripts(REPO);
yes('5 the record\'s scripts that change the box are read too (' + remote.length + '), Reset-Character.ps1 among them',
  remote.indexOf('scripts/ops/Reset-Character.ps1') >= 0 && scripts.indexOf('scripts/ops/Reset-Character.ps1') < 0 &&
  held.indexOf('scripts/ops/Reset-Character.ps1') >= 0 && scripts.every((x) => held.indexOf(x) >= 0));
const record = JSON.parse(read(A.REMOTE_RECORD)).calls;
const onlyThese = (s) => record.filter((r) => r.script === s).every((r) => A.CHANGES_NOTHING.indexOf(r.class) >= 0);
yes('  a script whose every call only reads or carries its caller\'s is not',
  record.some((r) => onlyThese(r.script)) && record.filter((r) => onlyThese(r.script)).every((r) => remote.indexOf(r.script) < 0));
for (const f of ['scripts/ops/Reset-Character.ps1', 'scripts/vps/Harden-VPS.ps1', 'scripts/deploy/Rotate-BotToken.ps1']) {
  yes('5 a Claude session\'s that changes ' + f + ' stays off', !A.judge(pr(33, { headRefName: 'claude/x', paths: [f] }), 'main', held)[0]);
}
yes('  and Patrick\'s own goes on', A.judge(pr(34, { headRefName: 'patrick-reset', paths: ['scripts/ops/Reset-Character.ps1'] }), 'main', held)[0]);
{
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw7443-'));
  const write = (calls) => { fs.mkdirSync(path.join(root, 'records'), { recursive: true }); fs.writeFileSync(path.join(root, A.REMOTE_RECORD), JSON.stringify({ calls })); };
  try {
    write([{ script: 'a.ps1', class: 'admin' }, { script: 'b.ps1', class: 'read-status' }, { script: 'c.ps1', class: 'transport' },
      { script: 'd.ps1', class: 'stage' }, { script: 'e.ps1', class: 'something new' }, { script: 'f.ps1' }, { script: 'a.ps1', class: 'swap' }]);
    yes('  a class that is not read-status or transport counts, a new one or none too, each script once',
      A.remoteScripts(root).join(' ') === 'a.ps1 d.ps1 e.ps1 f.ps1');
    write([]);
    let threw = '';
    try { A.remoteScripts(root); } catch (e) { threw = e.message; }
    yes('  a record with no calls stops the run rather than holding nothing', /lists no calls/.test(threw));
    write([{ class: 'admin' }]);
    threw = '';
    try { A.remoteScripts(root); } catch (e) { threw = e.message; }
    yes('  and so does a call with no script', /no script/.test(threw));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
yes('5 Patrick\'s that changes them goes on', on5(pr(32, { headRefName: 'patrick-gate', paths: ['.github/workflows/build-pr.yml', 'scripts/vps/gate/GateRules.ps1', 'scripts/ops/Reset-Npcs.ps1'] })));
// Ops #353 (Patrick's A on his page, 15 Nov 2026): a Claude session's
// branch is opened with Patrick's sign-in, and counts as his only for what
// does not run on the box.
const claude = (paths) => pr(38, { headRefName: 'claude/project-thread-abc123', paths });
yes('5 a Claude session\'s, authored as Patrick, that changes a workflow, the gate or a verb\'s file stays off',
  !on5(claude(['.github/workflows/build-pr.yml'])) && !on5(claude(['scripts/vps/gate/verbs.json'])) && !on5(claude(['scripts/ops/Reset-Npcs.ps1'])) && !on5(claude(['scripts/vps/box-keys/x.json'])));
yes('  and says it merges on Patrick\'s Main card, which Bramble opens', /a Claude session's branch that changes what runs on the live box \(\.github\/workflows\/build-pr\.yml\); it merges on Patrick's Main card, which Bramble opens/.test(judge5(claude(['.github/workflows/build-pr.yml']))[1]));
yes('  a Claude session\'s that changes nothing the box runs goes on', on5(claude(['game/gamemode/a.ts', 'tests/test-auto-merge.js'])));
yes('  a branch whose name only starts like claude counts as Patrick\'s', on5(pr(39, { headRefName: 'claudette/x', paths: ['.github/workflows/build-pr.yml'] })));
yes('5 one changing only what the box does not run goes on, whoever\'s it is', on5(pr(33, Object.assign({}, worker, { paths: ['scripts/ops/Auto-Merge.js', 'tests/test-auto-merge.js'] }))));
const bot = (more) => pr(34, Object.assign({ author: { login: 'thornswood-workers' }, headRefName: 'magpie/5327-dependabot-rebase', headRefOid: 'h34' }, more || {}));
const review = (login, oid) => ({ nodes: [{ author: { login }, commit: { oid } }] });
yes('5 a Bot\'s with no review of Bramble\'s stays off, and says Bramble turns it on', !on5(bot()) && /Bramble reviews it and turns auto-merge on/.test(judge5(bot())[1]));
yes('5 a Bot\'s Bramble approved at its head goes on', on5(bot({ reviews: review('thornswood-bramble', 'h34') })) && on5(bot({ reviews: review('thornswood-bramble[bot]', 'h34') })));
yes('5 a Bot\'s Bramble approved at an older commit stays off', !on5(bot({ reviews: review('thornswood-bramble', 'h33') })));
yes('5 a Bot\'s approved by somebody else stays off', !on5(bot({ reviews: review('EvilPatrick06', 'h34') })));
yes('5 Bramble\'s own branch counts as a Bot\'s', !on5(bot({ author: { login: 'thornswood-bramble' }, headRefName: 'bramble/5334-decided-tunnel-run' })));
yes('5 the query asks for its files and its approving reviews', /files\(first: 100\)/.test(A.QUERY) && /reviews\(last: 50, states: \[APPROVED\]\)/.test(A.QUERY) && /headRefName/.test(A.QUERY));

// ---- 6. outside work
const outside = { labels: { nodes: [{ name: 'area: Bot' }, { name: 'outside work' }] } };
yes('6 Patrick\'s own pull request labelled outside work stays off', !on5(pr(40, outside)));
yes('  and says it waits for Patrick\'s word', /outside contributor's work \('outside work'\), which merges only on Patrick's word/.test(judge5(pr(40, outside))[1]));
yes('6 one with other labels and not that one goes on', on5(pr(41, { labels: { nodes: [{ name: 'area: Bot' }] } })));
yes('6 the query asks for its labels', /labels\(first: 30\) \{ nodes \{ name \} \}/.test(A.QUERY) && A.OUTSIDE_LABEL === 'outside work');

// ---- 3. the sweep
function fake(pages, refuse) {
  const calls = [];
  const gql = async (q, v) => {
    calls.push({ q, v });
    if (q === A.QUERY) {
      const i = v.after ? Number(v.after) : 0;
      return { repository: { pullRequests: { nodes: pages[i], pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: String(i + 1) } } } };
    }
    if (q === A.FILES) {
      return { repository: { pullRequest: { files: { nodes: [{ path: '.github/workflows/build.yml' }], pageInfo: { hasNextPage: false } } } } };
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
    /\n        with:\n          ref: main\n          persist-credentials: false\n          sparse-checkout: \|\n            scripts\/ops\n/.test(wf) && !/pull_request_target|head_sha|head_branch|github\.event\.pull_request/.test(code_));
  yes('4 it runs in the engine-pin environment, and the run\'s own token only reads',
    /\n    environment: engine-pin\n    permissions:\n      contents: read\n    steps:\n/.test(wf));
  yes('4 it mints the pin robot\'s token there, with contents, pull requests and issues write (a queue merge closes its Closes issues as the one who queued it), and reads no other secret',
    /\n      - name: The pin robot's token\n        id: app\n        uses: actions\/create-github-app-token@[0-9a-f]{40} # v\S+\n        with:\n          client-id: \$\{\{ vars\.PIN_APP_CLIENT_ID \}\}\n          private-key: \$\{\{ secrets\.PIN_APP_KEY \}\}\n          permission-contents: write\n          permission-pull-requests: write\n          permission-issues: write\n/.test(wf) &&
    (code_.match(/secrets\.\w+/g) || []).every(x => x === 'secrets.PIN_APP_KEY'));
  yes('4 it runs the script with the App\'s token, never the run\'s own (whose queue entries start no checks)',
    /\n        env:\n          GH_TOKEN: \$\{\{ steps\.app\.outputs\.token \}\}\n          REPO: \$\{\{ github\.repository \}\}\n        run: node scripts\/ops\/Auto-Merge\.js\n/.test(wf) && !/github\.token/.test(code_));
  yes('4 one at a time, the newest wins', /\nconcurrency:\n  group: auto-merge\n  cancel-in-progress: true\n/.test(wf));
  // ---- 5. the sweep reads every file
  const many = pr(40, { author: { login: 'thornswood-workers' }, files: { nodes: [{ path: 'README.md' }], pageInfo: { hasNextPage: true, endCursor: 'c1' } } });
  f = fake([[many, pr(41, { files: { nodes: [{ path: 'README.md' }], pageInfo: { hasNextPage: false } } })]]);
  said = [];
  code = await A.sweep('ThornswoodRP/Thornswood', f.gql, (l) => said.push(l), { scripts });
  yes('5 a file past the first hundred is read: one changing a workflow there stays off',
    code === 0 && JSON.stringify(f.enabled()) === '["PR_41"]' && f.calls.some(c => c.q === A.FILES && c.v.number === 40 && c.v.after === 'c1') &&
    said.some(l => /^#40 left: it changes what runs on the live box/.test(l)));
  yes('5 the workflow checks out the verb lists and the remote command record beside the script, and the script reads them',
    /\n          sparse-checkout: \|\n            scripts\/ops\n            scripts\/vps\/gate\/verbs\.json\n            scripts\/release\/nexus-verbs\.json\n            records\/remote-commands\.json\n          sparse-checkout-cone-mode: false\n/.test(wf) &&
    /boxScripts\(require\('path'\)\.join\(__dirname, '\.\.', '\.\.'\)\)/.test(read('scripts/ops/Auto-Merge.js')));
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('FAIL  ' + e.stack); process.exitCode = 1; });
