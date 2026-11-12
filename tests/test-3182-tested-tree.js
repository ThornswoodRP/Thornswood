// #3182: main's build stops green when a pull request build of this
// repository already passed HEAD's tree, and builds in full otherwise.
// Offline: scripts/dev/Tested-Tree.js against stand-in GitHub answers, and
// build.yml's wiring read from the file. Nothing reaches GitHub.
//
// What is held here:
//   1. only the TESTED-TREE line of this tree, in the log of a green
//      build-pr.yml run's Launcher builds job that reached its last step,
//      for the head of a pull request of this repository merged as HEAD,
//      counts; another tree in the line, a log with no line, a fork, a push
//      run, a failed job, a job that stopped before the note, a pull request
//      not merged or from a fork, a question GitHub will not answer: main
//      builds. Since #3399 the note is a line of the log, not an artifact,
//      so this asks no artifact anything.
//   1a. the merge queue (#5182): a passed merge_group run of build-pr.yml on
//      a gh-readonly-queue/ branch, whose commit is HEAD or whose commit's
//      tree is HEAD's, counts under the same rules, and is read before any
//      pull request's own run; a run of another tree, of another workflow,
//      of a fork, of a gate that ran less, or one that is not the queue's
//      does not.
//   2. build.yml asks first, on push only, on a light runner, with nothing
//      but actions, contents and pull-requests read; the launcher job waits
//      for it and builds when it found nothing; the note is the last step of
//      the checks, pull request and merge queue only, under the name the script looks for,
//      and counts only beside every share of the gate passed (the job
//      "gate", 31 Oct 2026), and no step of either build uploads an
//      artifact.
//   3. why the tree is enough. One commit is checked out on both builds, so
//      a check sees the same files and no history either way. What differs
//      is the event, the ref, the commit's id: no check step and no harness
//      or script reads GitHub's event or ref variables, which is what would
//      make one tree pass on a pull request and fail on main. The lint
//      (#3185) does, and only reports: it cannot fail a build. (A check that
//      reads the commit id or branch name off git was looked for by running
//      every gate harness on a pull request checkout and a main checkout of
//      one tree, #3114; the nightly runs them all on main each night.)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } }
function read(f) { try { return fs.readFileSync(f, 'utf8').split('\r\n').join('\n'); } catch (e) { return ''; } }

const T = require(path.join(REPO, 'scripts', 'dev', 'Tested-Tree.js'));
const REPO_NAME = 'ThornswoodRP/Thornswood';
const TREE = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const COMMIT = 'c'.repeat(40);
const HEAD = 'd'.repeat(40);

/* A stand-in GitHub: the pull requests of COMMIT, the runs of each head,
   jobs by run id and logs by job id. */
function github(o) {
  const asked = [];
  const get = async p => {
    asked.push(p);
    if (o.down) { throw new Error('GET answered 502'); }
    let m = /^repos\/[^/]+\/[^/]+\/actions\/workflows\/build-pr\.yml\/runs\?event=merge_group&status=success&per_page=50$/.exec(p);
    if (m) { return { workflow_runs: o.groups || [] }; }
    m = /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40})\/pulls\?per_page=100$/.exec(p);
    if (m) { return m[1] === COMMIT ? (o.pulls || []) : []; }
    m = /^repos\/[^/]+\/[^/]+\/actions\/workflows\/build-pr\.yml\/runs\?event=pull_request&head_sha=([0-9a-f]{40})&per_page=100$/.exec(p);
    if (m) { return { workflow_runs: (o.runs || []).filter(r => r.head_sha === m[1]) }; }
    m = /^repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs\?per_page=100$/.exec(p);
    if (m) { return { jobs: (o.jobs || {})[m[1]] || [] }; }
    m = /^repos\/[^/]+\/[^/]+\/actions\/jobs\/(\d+)\/logs$/.exec(p);
    if (m) { if (!(o.logs || {})[m[1]]) { throw new Error('GET answered 404'); } return o.logs[m[1]]; }
    throw new Error('the stand-in was asked ' + p);
  };
  get.asked = asked;
  return get;
}
function pull(extra) { return Object.assign({ number: 3190, merged_at: '2026-10-26T17:00:00Z', head: { sha: HEAD, repo: { full_name: REPO_NAME } } }, extra || {}); }
function run(id, extra) {
  return Object.assign({ id: id, path: T.WORKFLOW, event: 'pull_request', head_sha: HEAD, html_url: 'https://github.com/' + REPO_NAME + '/actions/runs/' + id,
    repository: { full_name: REPO_NAME }, head_repository: { full_name: REPO_NAME } }, extra || {});
}
// The jobs of run <id>: <name> with job id <id>0, its last step the note
// unless stepConclusion is null, the gate's five shares (all passed unless
// shares is given), the Tree checks job (#5292, passed unless tree is given)
// and the check that reads their results.
function jobs(id, name, conclusion, stepConclusion, shares, tree) {
  const steps = [{ name: 'Lint (warnings only)', conclusion: 'success' }];
  if (stepConclusion !== null) { steps.push({ name: T.STEP, conclusion: stepConclusion || 'success' }); }
  const gate = shares || [1, 2, 3, 4, 5].map(n => ({ name: 'Gate harnesses (' + n + ' of 5)', conclusion: 'success' }));
  return [{ id: id * 10, name: name, conclusion: conclusion, steps: steps }].concat(
    gate.map((g, i) => Object.assign({ id: id * 100 + i, steps: [{ name: 'Run the gate harnesses', conclusion: g.conclusion }] }, g)),
    tree === null ? [] : [{ id: id * 1000, name: 'Tree checks', conclusion: tree || 'success', steps: [{ name: 'Lint (warnings only)', conclusion: 'success' }] }],
    [{ id: 1, name: 'Build check result', conclusion: conclusion, steps: [] }]);
}
function shares(fix) { return [1, 2, 3, 4, 5].map(n => ({ name: 'Gate harnesses (' + n + ' of 5)', conclusion: 'success' })).map(fix); }
// A job's log as GitHub hands it over: timestamps, the step's echo of its
// own script (which must not count), and the line itself.
function jobLog(tree) {
  return ['2026-10-26T16:59:01.0000000Z ##[group]Run $tree = (git rev-parse \'HEAD^{tree}\' | Out-String).Trim()',
          '2026-10-26T16:59:01.0000001Z \u001b[36;1mWrite-Host (\'' + T.MARK + ' {0} commit {1}\' -f $tree)\u001b[0m',
          '2026-10-26T16:59:02.1234567Z ' + T.MARK + ' ' + tree + ' commit ' + 'e'.repeat(40) + ' pull request 3190 head ' + HEAD,
          '2026-10-26T16:59:02.2000000Z ##[endgroup]'].join('\r\n');
}
function world(id, name, extra) {
  return Object.assign({ pulls: [pull()], runs: [run(id)], jobs: { [id]: jobs(id, name || 'Launcher builds', 'success') }, logs: { [id * 10]: jobLog(TREE) } }, extra || {});
}
// A passed run of the merge queue (#5182): its commit COMMIT, of tree TREE.
function group(id, extra) {
  return Object.assign(run(id, { event: 'merge_group', head_sha: COMMIT, head_branch: 'gh-readonly-queue/main/pr-3190-' + 'e'.repeat(40),
    head_commit: { id: COMMIT, tree_id: TREE } }), extra || {});
}
function queueWorld(id, extra) {
  return Object.assign({ pulls: [], runs: [], groups: [group(id)], jobs: { [id]: jobs(id, 'Launcher builds', 'success') }, logs: { [id * 10]: jobLog(TREE) } }, extra || {});
}
async function ask(o, tree) { const g = github(o); return T.find({ tree: tree || TREE, commit: COMMIT, repo: REPO_NAME, get: g, getText: g }); }

(async () => {
  // ---- 1. what counts --------------------------------------------------------
  const good = world(11);
  let r = await ask(good);
  yes('a green build of this tree, for the head of the pull request merged as HEAD, counts, and names its run: ' + r.why,
      r.run === 'https://github.com/' + REPO_NAME + '/actions/runs/11' && /#3190/.test(r.why));
  r = await ask(world(12, 'Launcher builds (VPS fallback)'));
  yes('the box\'s old fallback job does not (it never wrote the note, #3874; gone since #4983)', r.run === '');
  r = await ask(good, OTHER);
  yes('another tree does not: ' + r.why, r.run === '' && /another tree/.test(r.why));
  r = await ask(world(11, null, { logs: { 110: '2026-10-26T16:59:02Z the gate passed\n' } }));
  yes('a log with no note line does not: ' + r.why, r.run === '' && /no TESTED-TREE line/.test(r.why));
  r = await ask(world(11, null, { logs: { 110: jobLog(TREE).replace(/\r\n2026-10-26T16:59:02\.1234567Z [^\r]*/, '') } }));
  yes('the step\'s echo of its own script is not the line', r.run === '');
  r = await ask(world(13, null, { runs: [run(13, { head_repository: { full_name: 'someone/Thornswood' } })] }));
  yes('a fork\'s pull request build does not, whatever tree it names: ' + r.why, r.run === '' && /not this repository/.test(r.why));
  r = await ask(world(13, null, { pulls: [pull({ head: { sha: HEAD, repo: { full_name: 'someone/Thornswood' } } })] }));
  yes('nor does a pull request whose head is a fork: ' + r.why, r.run === '' && /no pull request of this repository was merged/.test(r.why));
  r = await ask(world(13, null, { pulls: [pull({ merged_at: null })] }));
  yes('nor one that was never merged', r.run === '');
  r = await ask(world(13, null, { pulls: [] }));
  yes('a commit no pull request was merged as builds in full: ' + r.why, r.run === '' && /no pull request/.test(r.why));
  r = await ask(world(14, null, { runs: [run(14, { event: 'push', path: '.github/workflows/build.yml' })] }));
  yes('a run of another workflow does not: ' + r.why, r.run === '' && /not \.github\/workflows\/build-pr\.yml/.test(r.why));
  r = await ask(world(15, null, { runs: [run(15, { event: 'workflow_dispatch' })] }));
  yes('a build-pr.yml run that is not a pull request does not', r.run === '' && /not a pull request build/.test(r.why));
  r = await ask(world(15, null, { runs: [run(15, { head_sha: 'f'.repeat(40) })] }));
  yes('a run of another head does not, whatever the query gave: ' + r.why, r.run === '' && /no pull request build of its head/.test(r.why));
  r = await ask(world(16, null, { jobs: { 16: jobs(16, 'Launcher builds', 'failure') } }));
  yes('a build whose job failed does not: ' + r.why, r.run === '' && /no Launcher builds job passed/.test(r.why));
  r = await ask(world(17, null, { jobs: { 17: jobs(17, 'Launcher builds', 'success', null) } }));
  yes('a job that never reached the note does not', r.run === '');
  r = await ask(world(18, null, { jobs: { 18: jobs(18, 'Launcher builds', 'success', 'failure') } }));
  yes('a job whose note step failed does not', r.run === '');
  r = await ask(world(19, 'Some other job'));
  yes('a green job of another name does not', r.run === '');
  // The gate runs beside the launcher job in shares (31 Oct 2026): the note
  // counts only when every share of the same run passed.
  r = await ask(world(21, null, { jobs: { 21: jobs(21, 'Launcher builds', 'success', 'success', shares((g, i) => i === 2 ? Object.assign(g, { conclusion: 'failure' }) : g)) } }));
  yes('a run whose gate share failed does not: ' + r.why, r.run === '' && /gate share 3 of 5 did not pass/.test(r.why));
  r = await ask(world(21, null, { jobs: { 21: jobs(21, 'Launcher builds', 'success', 'success', shares((g, i) => i === 4 ? Object.assign(g, { conclusion: 'cancelled' }) : g)) } }));
  yes('nor one whose share was cancelled', r.run === '' && /gate share 5 of 5 did not pass/.test(r.why));
  r = await ask(world(21, null, { jobs: { 21: jobs(21, 'Launcher builds', 'success', 'success', shares(g => g).slice(0, 4)) } }));
  yes('nor one missing a share: ' + r.why, r.run === '' && /gate share 5 of 5 is not in it/.test(r.why));
  r = await ask(world(21, null, { jobs: { 21: jobs(21, 'Launcher builds', 'success', 'success', []) } }));
  yes('nor one with no gate at all: ' + r.why, r.run === '' && /no share of the gate ran/.test(r.why));
  r = await ask(world(21, null, { jobs: { 21: jobs(21, 'Launcher builds', 'success', 'success', shares((g, i) => i === 0 ? Object.assign(g, { name: 'Gate harnesses (1 of 4)' }) : g)) } }));
  yes('nor one whose shares disagree how many there are', r.run === '' && /do not agree/.test(r.why));
  r = await ask(world(21, null, { jobs: { 21: jobs(21, 'Launcher builds', 'success', 'success', shares(g => g).concat([{ name: 'Gate harnesses (2 of 5)', conclusion: 'success' }])) } }));
  yes('nor one with a share twice', r.run === '' && /ran twice/.test(r.why));
  // Since #5183 a pull request's shares may run only what its change can
  // reach, and say so in their names; main then runs the whole gate.
  r = await ask(world(21, null, { jobs: { 21: jobs(21, 'Launcher builds', 'success', 'success', shares(g => Object.assign(g, { name: g.name.replace(')', ', what the change reaches)') }))) } }));
  yes('nor one whose shares ran only what its change reaches: ' + r.why, r.run === '' && /only what its change can reach/.test(r.why));
  // #5292: the tree checks run in a job of their own on Linux.
  r = await ask({ pulls: [pull()], runs: [run(17)], jobs: { 17: jobs(17, 'Launcher builds', 'success', 'success', null, 'failure') }, logs: { 170: jobLog(TREE) } });
  yes('nor one whose Tree checks failed (#5292): ' + r.why, r.run === '' && /its Tree checks job did not pass/.test(r.why));
  r = await ask({ pulls: [pull()], runs: [run(18)], jobs: { 18: jobs(18, 'Launcher builds', 'success', 'success', null, null) }, logs: { 180: jobLog(TREE) } });
  yes('nor one with no Tree checks job at all: ' + r.why, r.run === '' && /its Tree checks job did not pass/.test(r.why));
  // #5293: the harnesses that need nothing from Windows run in shares on
  // Linux, counted as the Windows ones are, and the run's Build check result
  // has to have passed, since it is what says no share was skipped for a
  // reason the pick did not give.
  const lin = (fix) => [1, 2, 3, 4].map(n => ({ name: 'Gate harnesses on Linux (' + n + ' of 4)', conclusion: 'success' })).map(fix || (g => g));
  const both = (w, l) => ({ pulls: [pull()], runs: [run(22)], jobs: { 22: jobs(22, 'Launcher builds', 'success', 'success', w.concat(l)) }, logs: { 220: jobLog(TREE) } });
  r = await ask(both(shares(g => g), lin()));
  yes('a run whose Windows and Linux shares all passed counts (#5293): ' + r.why, r.run.endsWith('/22'));
  r = await ask(both(shares(g => g), lin((g, i) => i === 1 ? Object.assign(g, { conclusion: 'failure' }) : g)));
  yes('  not one whose Linux share failed: ' + r.why, r.run === '' && /gate share 2 of 4 on Linux did not pass/.test(r.why));
  r = await ask(both(shares(g => g), lin().slice(1)));
  yes('  nor one missing a Linux share: ' + r.why, r.run === '' && /gate share 1 of 4 on Linux is not in it/.test(r.why));
  r = await ask(both(shares(g => g), lin(g => Object.assign(g, { name: g.name.replace(')', ', what the change reaches)') }))));
  yes('  nor one whose Linux shares ran only what its change reaches: ' + r.why, r.run === '' && /only what its change can reach/.test(r.why));
  r = await ask(both([], lin()));
  yes('  a run of Linux shares alone counts, the Windows ones being none: ' + r.why, r.run.endsWith('/22'));
  const noResult = both(shares(g => g), lin());
  noResult.jobs[22] = noResult.jobs[22].map(x => x.name === T.RESULT ? Object.assign({}, x, { conclusion: 'failure' }) : x);
  r = await ask(noResult);
  yes('  nor one whose Build check result failed: ' + r.why, r.run === '' && /its Build check result job did not pass/.test(r.why));
  noResult.jobs[22] = noResult.jobs[22].filter(x => x.name !== T.RESULT);
  r = await ask(noResult);
  yes('  nor one with no Build check result: ' + r.why, r.run === '' && /its Build check result job did not pass/.test(r.why));
  yes('  the Linux shares are read by the name build.yml gives them', T.GATE_LINUX.test('Gate harnesses on Linux (3 of 4)') && !T.GATE.test('Gate harnesses on Linux (3 of 4)') && !T.GATE_LINUX.test('Gate harnesses (3 of 4)'));
  r = await ask({ pulls: [pull()], runs: [run(16), run(11)], jobs: { 16: jobs(16, 'Launcher builds', 'failure'), 11: good.jobs[11] }, logs: good.logs });
  yes('a failed build of the head beside a green one: the green one counts', r.run.endsWith('/11'));
  r = await ask({ pulls: [pull()], runs: [run(11), run(20)], jobs: { 11: good.jobs[11], 20: jobs(20, 'Launcher builds', 'success') }, logs: { 110: jobLog(TREE), 200: jobLog(OTHER) } });
  yes('the newest run is read first, and an older one of this tree still counts: ' + r.why, r.run.endsWith('/11') && /#3190/.test(r.why));
  r = await ask(world(11, null, { logs: { 110: jobLog(TREE).replace(T.MARK + ' ' + TREE, T.MARK + ' ' + TREE + 'x') } }));
  yes('only a whole tree id counts', r.run === '');
  r = await T.find({ tree: 'HEAD', commit: COMMIT, repo: REPO_NAME, get: github(good), getText: github(good) });
  yes('a tree that is not a tree id is not asked about', r.run === '' && /no tree/.test(r.why));
  r = await T.find({ tree: TREE, commit: '', repo: REPO_NAME, get: github(good), getText: github(good) });
  yes('nor is a missing commit', r.run === '' && /no commit/.test(r.why));
  const g = github(good);
  r = await T.find({ tree: TREE, commit: COMMIT, repo: '', get: g, getText: g });
  yes('nor is a missing repository', r.run === '' && g.asked.length === 0);
  const g2 = github(good);
  await T.find({ tree: TREE, commit: COMMIT, repo: REPO_NAME, get: g2, getText: g2 });
  yes('no artifact is asked about any more (#3399)', g2.asked.every(p => !/artifacts/.test(p)));

  // ---- 1a. the merge queue (#5182) ---------------------------------------------
  const queue = queueWorld(31);
  const gq = github(queue);
  r = await T.find({ tree: TREE, commit: COMMIT, repo: REPO_NAME, get: gq, getText: gq });
  yes('a passed merge queue run of HEAD counts, with no pull request asked about: ' + r.why,
      r.run.endsWith('/31') && /merge queue/.test(r.why) && gq.asked.every(p => !/\/pulls\?/.test(p)));
  r = await ask(queueWorld(31, { groups: [group(31, { head_sha: 'f'.repeat(40) })] }));
  yes('  so does one of another commit with HEAD\'s tree, if the queue lands a new commit: ' + r.why, r.run.endsWith('/31'));
  r = await ask(queueWorld(31, { groups: [group(31, { head_sha: 'f'.repeat(40), head_commit: { id: 'f'.repeat(40), tree_id: OTHER } })] }));
  yes('  one of another commit and tree is not read at all: ' + r.why, r.run === '' && /no passed merge queue run/.test(r.why));
  r = await ask(queueWorld(31, { logs: { 310: jobLog(OTHER) } }));
  yes('  one whose note names another tree does not: ' + r.why, r.run === '' && /another tree/.test(r.why));
  r = await ask(queueWorld(31, { groups: [group(31, { head_branch: 'main' })] }));
  yes('  a merge_group run off the queue\'s branches does not: ' + r.why, r.run === '' && /not a run of the merge queue/.test(r.why));
  r = await ask(queueWorld(31, { groups: [group(31, { event: 'pull_request' })] }));
  yes('  nor a run of another event the answer slipped in', r.run === '' && /not a run of the merge queue/.test(r.why));
  r = await ask(queueWorld(31, { groups: [group(31, { path: '.github/workflows/build.yml' })] }));
  yes('  nor a run of another workflow', r.run === '' && /not \.github\/workflows\/build-pr\.yml/.test(r.why));
  r = await ask(queueWorld(31, { groups: [group(31, { head_repository: { full_name: 'someone/Thornswood' } })] }));
  yes('  nor a fork\'s', r.run === '' && /not this repository/.test(r.why));
  r = await ask(queueWorld(31, { jobs: { 31: jobs(31, 'Launcher builds', 'success', 'success', shares(g => Object.assign(g, { name: g.name.replace(')', ', what the change reaches)') }))) } }));
  yes('  nor one whose gate ran only what a change reaches', r.run === '' && /only what its change can reach/.test(r.why));
  r = await ask(queueWorld(31, { jobs: { 31: jobs(31, 'Launcher builds', 'success', null) } }));
  yes('  nor one whose launcher job never reached the note', r.run === '' && /no Launcher builds job passed/.test(r.why));
  r = await ask(Object.assign(world(11), { groups: [group(31, { head_commit: { id: COMMIT, tree_id: OTHER }, head_sha: 'f'.repeat(40) })] }));
  yes('  with no queue run, a pull request merged before the queue still counts: ' + r.why, r.run.endsWith('/11') && /#3190/.test(r.why));
  r = await ask(Object.assign(queueWorld(31, { logs: { 310: jobLog(OTHER) } }), { pulls: [] }));
  yes('  and when neither counts, both reasons are given: ' + r.why, r.run === '' && /another tree/.test(r.why) && /no pull request/.test(r.why));

  // GitHub that will not answer: main builds, and the script still ends 0.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tested-tree-'));
  const out = path.join(scratch, 'output');
  const logs = []; const log = console.log; console.log = s => logs.push(String(s));
  try {
    fs.writeFileSync(out, '');
    r = await T.main(['--tree', TREE, '--commit', COMMIT, '--repo', REPO_NAME], { GITHUB_OUTPUT: out }, github({ down: true }));
    const down = fs.readFileSync(out, 'utf8');
    fs.writeFileSync(out, '');
    const r2 = await T.main(['--tree', TREE, '--commit', COMMIT, '--repo', REPO_NAME], { GITHUB_OUTPUT: out }, github(good));
    const up = fs.readFileSync(out, 'utf8');
    console.log = log;
    yes('GitHub down: nothing is written, so main builds in full: ' + logs[0], r.run === '' && down === '' && /builds in full/.test(logs[0]));
    yes('a tree that passed writes run=<its address> for the jobs to read', r2.run !== '' && up === 'run=' + r2.run + '\n');
  } finally { console.log = log; fs.rmSync(scratch, { recursive: true, force: true }); }
  const src = read(path.join(REPO, 'scripts', 'dev', 'Tested-Tree.js'));
  yes('run as a command it always ends 0, so it can never fail main', /\.then\(\(\) => process\.exit\(0\), \(\) => process\.exit\(0\)\)/.test(src));

  // ---- 2. build.yml's wiring -------------------------------------------------
  const build = read(path.join(REPO, '.github', 'workflows', 'build.yml'));
  const pr = read(path.join(REPO, '.github', 'workflows', 'build-pr.yml'));
  const job = /\njobs:\n(?:  #.*\n)*  tested:\n([\s\S]*?)\n\n/.exec(build);
  const tj = job ? job[1] : '';
  yes('build.yml\'s first job is "tested"', !!job);
  yes('  on a push only, so a manual run always builds', /\n    if: \$\{\{ github\.event_name == 'push' \}\}\n/.test(tj));
  // #3551: the build waits for this answer, so it asks on GitHub's runner.
  const runsOn = (/\n    runs-on: ([^\n]*)\n/.exec(tj) || ['', ''])[1];
  yes('  on GitHub\'s hosted runner, not the box (#3551): ' + runsOn, runsOn === 'ubuntu-latest' && !/self-hosted|thornswood-/.test(runsOn));
  yes('  with no fallback on the box (#4983)', build.indexOf('\n  tested-vps:\n') < 0 && build.indexOf('\n  launcher-vps:\n') < 0);
  yes('  with only actions, contents and pull-requests read', /\n    permissions:\n      actions: read\n      contents: read\n      pull-requests: read\n    outputs:/.test(tj));
  yes('  and no secrets', !/secrets\./.test(tj));
  yes('  its output is the script\'s', /\n      run: \$\{\{ steps\.look\.outputs\.run \}\}\n/.test(tj) && /id: look\n/.test(tj) &&
      /node scripts\/dev\/Tested-Tree\.js --tree \$tree --commit \$env:GITHUB_SHA --repo \$env:GITHUB_REPOSITORY\n/.test(tj) && /git rev-parse 'HEAD\^\{tree\}'/.test(tj));
  yes('the build waits for the answer and builds only when it found nothing',
      /\n  launcher:\n    name: Launcher builds\n    needs: \[tested, pick\]\n    if: \$\{\{ !cancelled\(\) && needs\.tested\.outputs\.run == '' \}\}\n/.test(build) &&
      /\n  checks:\n    name: Tree checks\n    needs: tested\n    if: \$\{\{ !cancelled\(\) && needs\.tested\.outputs\.run == '' \}\}\n/.test(build));
  // The checks are the launcher job's steps and, since #5292, the Tree
  // checks job's, each without the comments that stand before the next one.
  // The launcher job is the last job; Tree checks is the one before it.
  const lj = build.indexOf('\n  launcher:\n');
  const cj = build.indexOf('\n  checks:\n');
  const stepsOf = (t) => t.split(/\n(?=      - )/).filter(s => /^      - /.test(s)).map(s => s.replace(/(\n *#[^\n]*|\n *)+$/, '\n'));
  const checks = lj < 0 ? '' : build.slice(build.indexOf('\n    steps:\n', lj) + '\n    steps:\n'.length);
  const steps = stepsOf(checks);
  const treeJob = cj < 0 || cj > lj ? '' : build.slice(cj, lj);
  const treeSteps = stepsOf(treeJob.slice(treeJob.indexOf('\n    steps:\n') + '\n    steps:\n'.length));
  yes('the Tree checks job is the one before the launcher job, on Linux (#5292)', cj > 0 && cj < lj && /\n    runs-on: ubuntu-latest\n/.test(treeJob) && treeSteps.length > 10);
  yes('  and the script counts the note only beside its success (' + T.CHECKS + ')', T.CHECKS === 'Tree checks' && treeJob.indexOf('\n    name: ' + T.CHECKS + '\n') >= 0);
  const note = steps[steps.length - 1] || '';
  yes('the note is the last step of the checks, under the name the script looks for', note.indexOf('- name: ' + T.STEP + '\n') === 6);
  // #3874 wrote it only on GitHub's hosted runner, so a VPS build left main
  // to be built and traced. Every build is on GitHub's runner since #4983.
  yes('  on a pull request and in the merge queue only (#5182)',
      /\n        if: env\.REACHES != 'false' && \(github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'\)\n/.test(note));
  // #5292: when the pick says the change reaches nothing the job checks, the
  // job still runs, on Linux, and its first step says why; every other step
  // is for a build and runs only then, so that pass writes no note.
  const why = steps[0] || '';
  yes('  and a change the launcher build cannot see runs only the first step, which says why there is nothing to build (#5292)',
      /^      - name: Say why there is nothing to build\n        if: env\.REACHES == 'false'\n/.test(why) && !/\n\s+(shell|uses):/.test(why) &&
      steps.length > 2 && steps.slice(1).every(st => /\n        if: env\.REACHES != 'false'(\n| && \()/.test(st)) &&
      /\n    env:\n(\s*#[^\n]*\n)*      REACHES: \$\{\{ needs\.pick\.outputs\.launcher \}\}\n/.test(build.slice(lj)));
  // The gate runs in the job "gate" beside the launcher job, in shares
  // (31 Oct 2026), after the job "pick" says what each runs (#5183). A
  // share of what a change can reach says so in its name, and the script
  // counts the note only when every share passed and none says that.
  const gj = build.indexOf('\n  gate:\n');
  const pj = build.indexOf('\n  pick:\n');
  const pickJob = pj < 0 ? '' : build.slice(pj, gj > pj ? gj : undefined);
  const glj = build.indexOf('\n  gate-linux:\n');
  const gateJob = gj < 0 ? '' : build.slice(gj, glj > gj ? glj : (cj > gj ? cj : undefined));
  const linuxJob = glj < 0 ? '' : build.slice(glj, cj > glj ? cj : undefined);
  const gateStep = (gateJob.split(/\n(?=      - )/).find(x => /^      - name: Run the gate harnesses\n/.test(x)) || '');
  const rg = read(path.join(REPO, 'scripts', 'dev', 'Run-Gate.ps1'));
  const part = "${{ needs.pick.outputs.whole != 'true' && ', what the change reaches' || '' }}";
  yes('the gate is a job of its own before the launcher job, in shares the script reads by name, a part saying so',
      gj > 0 && gj < lj && gateJob.indexOf('\n    name: Gate harnesses (${{ matrix.shard }} of ${{ strategy.job-total }}' + part + ')\n') >= 0 &&
      T.GATE.test('Gate harnesses (1 of 5)') && T.GATE.exec('Gate harnesses (1 of 5, what the change reaches)')[3] && /\n      fail-fast: false\n/.test(gateJob));
  yes('  the pick waits for "tested" as the launcher job does, and the shares for both', pj > 0 && pj < gj &&
      /\n    needs: tested\n    if: \$\{\{ !cancelled\(\) && needs\.tested\.outputs\.run == '' \}\}\n/.test(pickJob) &&
      /\n    needs: \[tested, pick\]\n    if: \$\{\{ !cancelled\(\) && needs\.tested\.outputs\.run == '' && needs\.pick\.result == 'success' && needs\.pick\.outputs\.shares != '\[\]' \}\}\n/.test(gateJob));
  yes('  the pick runs Run-Gate.ps1 -Pick on Linux, with the token, and hands on its plan',
      /\n    runs-on: ubuntu-latest\n/.test(pickJob) && /\.\/scripts\/dev\/Run-Gate\.ps1 -Pick \(\[int\]\$env:SHARES\) -LinuxShares \(\[int\]\$env:LINUX_SHARES\)\n/.test(pickJob) &&
      /\n          GATE_MAP_TOKEN: \$\{\{ github\.token \}\}\n/.test(pickJob) && /\n      whole: \$\{\{ steps\.pick\.outputs\.whole \}\}\n/.test(pickJob));
  yes('the gate step is "gate", and runs its share of the plan through Run-Gate.ps1', /\n        id: gate\n/.test(gateStep) &&
      /\.\\scripts\\dev\\Run-Gate\.ps1 -Shard \$env:SHARD -Of \$env:OF /.test(gateStep) &&
      /\n          SHARD: \$\{\{ matrix\.shard \}\}\n          OF: \$\{\{ strategy\.job-total \}\}\n          GATE_PLAN: \$\{\{ needs\.pick\.outputs\.plan \}\}\n/.test(gateStep) &&
      /\n        shard: \$\{\{ fromJSON\(needs\.pick\.outputs\.shares\) \}\}\n/.test(gateJob));
  yes('  with no token: a share fetches no map', !/GATE_MAP_TOKEN|github\.token/.test(gateJob));
  const linuxStep = (linuxJob.split(/\n(?=      - )/).find(x => /^      - name: Run the gate harnesses\n/.test(x)) || '');
  yes('the Linux shares are the job "gate-linux" after it, on Linux, named as the script reads them (#5293)',
      glj > gj && glj < cj && /\n    runs-on: ubuntu-latest\n/.test(linuxJob) &&
      linuxJob.indexOf('\n    name: Gate harnesses on Linux (${{ matrix.shard }} of ${{ strategy.job-total }}' + part + ')\n') >= 0 &&
      /\n      fail-fast: false\n/.test(linuxJob) && /\n          LINUX_SHARES: '\d+'\n/.test(pickJob) &&
      /\n      linux_shares: \$\{\{ steps\.pick\.outputs\.linux_shares \}\}\n/.test(pickJob));
  yes('  waiting as the Windows shares do, skipped when the pick gave none',
      /\n    needs: \[tested, pick\]\n    if: \$\{\{ !cancelled\(\) && needs\.tested\.outputs\.run == '' && needs\.pick\.result == 'success' && needs\.pick\.outputs\.linux_shares != '\[\]' \}\}\n/.test(linuxJob) &&
      /\n        shard: \$\{\{ fromJSON\(needs\.pick\.outputs\.linux_shares\) \}\}\n/.test(linuxJob));
  yes('  and running its part of the same plan through Run-Gate.ps1 -Platform Linux, with no token',
      /\.\/scripts\/dev\/Run-Gate\.ps1 -Shard \$env:SHARD -Of \$env:OF -Platform Linux /.test(linuxStep) &&
      /\n          SHARD: \$\{\{ matrix\.shard \}\}\n          OF: \$\{\{ strategy\.job-total \}\}\n          GATE_PLAN: \$\{\{ needs\.pick\.outputs\.plan \}\}\n/.test(linuxStep) &&
      !/GATE_MAP_TOKEN|github\.token/.test(linuxJob));

  yes('  and the plan says whole only when it holds every gate harness',
      (rg.match(/Set-StepOutput 'whole'/g) || []).length === 2 && /\nif \(\$whole\) \{ Set-StepOutput 'whole' 'true' \}\n/.test(rg) &&
      /Set-StepOutput 'whole' \$\(if \(\$whole\) \{ 'true' \} else \{ 'false' \}\)/.test(rg) &&
      /\n\$run = \$gate\n\$whole = \$true\n/.test(rg) && /\{ \$list = \$picked; \$whole = \$false \}/.test(rg) &&
      /if \(\$picked\.Count -ge \$gate\.Count\) \{ return \$null \}/.test(rg) &&
      /if \(\$whole -and \$all\.Count -ne \$gate\.Count\)/.test(rg));
  yes('  writing the tree git gives for HEAD, in the line the script reads', /git rev-parse 'HEAD\^\{tree\}'/.test(note) &&
      note.indexOf("Write-Host ('" + T.MARK + " {0} commit {1} pull request {2} head {3}' -f $tree, $env:GITHUB_SHA, $env:PR_NUMBER, $env:PR_HEAD)") >= 0);
  yes('  the pull request number and head through env, never pasted into the script', /\n          PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}\n          PR_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}\n/.test(note) &&
      !/\$\{\{/.test(note.split('        run: |')[1] || ''));
  yes('the pull request build has the same note step', pr.indexOf(note) >= 0);
  // The gate's reports are the one artifact a build keeps (#5295, public
  // since 30 Oct 2026): the Windows shares', the Linux shares' (#5293) and
  // the merged one. The note is never one (#3399).
  const uploads = (y) => (y.replace(/^\s*#.*$/gm, '').match(/uses: actions\/upload-artifact@[\s\S]*?\n\s+name: (.+)/g) || []).map(m => m.replace(/[\s\S]*name: /, ''));
  const onlyReports = (y) => uploads(y).every(n => /^gate-report(-(linux-)?\$\{\{ matrix\.shard \}\})?$/.test(n));
  yes('no step of either build uploads an artifact but the gate\'s reports, and the note is never one (#3399, #5295)', onlyReports(build) && onlyReports(pr) && uploads(build).length === 3 && !/tested-tree/i.test(uploads(build).join(' ')));
  for (const n of T.JOBS) { yes('the script\'s job name "' + n + '" is a job in build-pr.yml', pr.indexOf('\n    name: ' + n + '\n') >= 0); }
  yes('the script\'s workflow is the pull request build', fs.existsSync(path.join(REPO, T.WORKFLOW)) && /\non:\n  pull_request:\n/.test(pr));
  yes('  and runs in the merge queue, whose run the script reads first (#5182)', /\non:\n  pull_request:\n  merge_group:\n    types: \[checks_requested\]\n/.test(pr));

  // ---- 3. why the tree is enough ---------------------------------------------
  const checkout = steps.find(st => /^      - uses: actions\/checkout@/.test(st)) || '';
  const treeCheckout = treeSteps[0] || '';
  yes('the checks check out one commit, with no history on either build, in both jobs', /^      - uses: actions\/checkout@[0-9a-f]{40} # v\d+(\.\d+)*\n/.test(checkout + '\n') && !/^\s+with:/m.test(checkout) &&
      /^      - uses: actions\/checkout@[0-9a-f]{40} # v\d+(\.\d+)*\n/.test(treeCheckout + '\n') && !/^\s+with:/m.test(treeCheckout));
  // The lint step is the one step that reads the event and fetches the
  // base (#3185): it reports warnings and cannot fail a build, and it is the
  // last step of the Tree checks job (#5292), so no check runs after its
  // fetch.
  const lint = treeSteps[treeSteps.length - 1] || '';
  yes('the last tree check is the lint, which cannot fail a build', /^      - name: Lint \(warnings only\)\n/.test(lint) &&
      /\n        continue-on-error: true\n/.test(lint) && /\n          \.\/scripts\/dev\/Lint\.ps1 -All\n          exit 0\n/.test(lint) &&
      /\nexit 0\s*$/.test(read(path.join(REPO, 'scripts', 'dev', 'Lint.ps1'))));
  const before = steps.slice(0, -1).concat(treeSteps.slice(0, -1)).join('\n').replace(/^\s*#.*$/gm, '');
  const EVENT = /github\.(event|ref|ref_name|sha|head_ref|base_ref|run_id|run_number|actor)\b|GITHUB_(EVENT_NAME|EVENT_PATH|REF|REF_NAME|REF_TYPE|SHA|HEAD_REF|BASE_REF|RUN_ID|RUN_NUMBER|ACTOR)\b/;
  yes('no check step reads the event, the ref or the commit', !EVENT.test(before));
  yes('no check step fetches more history', !/git(\.exe)?\s+fetch|fetch-depth/.test(before));
  // Every harness and every script: GitHub's event and ref variables are read
  // only where named here, each with why it is not a check of a build.
  const ALLOWED = {
    'tests/test-5181-promote-main.ps1': 'reads promote-main.yml\'s text for the run id its Deployment names; promote-main.yml is started by hand on main and is no check of a build (#5181)',
    'scripts/dev/Run-Gate.ps1': 'the gate step: the event chooses only how much of the gate runs (#3114), and a build that ran less than all of it keeps no note, held above',
    'tests/test-3114-run-gate.ps1': 'sets those names for Run-Gate.ps1 in scratch processes, to hold what it does on each event',
    'scripts/release/Sign-OnRunner.ps1': 'signs in the release workflows only, never in a check of a build: it reads the ref to refuse signing on any branch but main (#3930)',
    'scripts/dev/Launcher-Reach.ps1': 'the pick\'s path rule (#5292): the event chooses only whether the launcher job builds, and a pull request build that built nothing keeps no note, so main builds',
    'tests/test-5292-path-rule.ps1': 'sets those names for Launcher-Reach.ps1 in scratch processes, to hold what it says on each event',
    'tests/test-5179-merge-release.ps1': 'sets GITHUB_SHA for merge-release.yml\'s notes step, run in a scratch process over a stand-in; merge-release.yml runs on main after a merge and is no check of a build (#5179)',
    'scripts/ops/Box-Step.js': 'box-step.yml\'s issue event: which issue was opened, edited or closed (#5611); it runs on issues and a schedule, never in a check of a build'
  };
  const ENVREAD = /\b(GITHUB_(EVENT_NAME|EVENT_PATH|REF|REF_NAME|REF_TYPE|SHA|HEAD_REF|BASE_REF|RUN_ID|RUN_NUMBER|ACTOR))\b/;
  const found = [];
  const walk = d => {
    for (const e of fs.readdirSync(path.join(REPO, d), { withFileTypes: true })) {
      const rel = d + '/' + e.name;
      if (e.isDirectory()) { if (e.name !== 'node_modules') { walk(rel); } continue; }
      if (!/\.(js|ps1|psm1|py|sh|cmd|bat)$/.test(e.name) || rel === 'tests/test-3182-tested-tree.js') { continue; }
      if (ENVREAD.test(read(path.join(REPO, rel)))) { found.push(rel); }
    }
  };
  walk('tests'); walk('scripts');
  const loose = found.filter(f => !ALLOWED[f]);
  yes('no harness or script reads the event or ref but those named here (' + (loose.join(', ') || 'none') + ')', loose.length === 0);
  for (const f of Object.keys(ALLOWED)) { yes('  ' + f + ' is still one (' + ALLOWED[f] + ')', found.indexOf(f) >= 0); }

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL ' + (e && e.stack || e)); process.exit(1); });
