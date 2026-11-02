#!/usr/bin/env node
// scripts/dev/Tested-Tree.js
//
// #3182: main's build ran every check again on the commit its pull request
// had just passed, 26 minutes of a build runner each time (run 39690135051
// for #3125 on 21 Oct 2026), and 905 box minutes that day. A squash merge of
// a pull request whose build ran against the main it lands on gives main the
// very tree that build checked, so build.yml's first job asks this script
// whether a green pull request build already checked HEAD's tree. When one
// did, main's build says which run and stops green; otherwise it builds in
// full, as before.
//
// WHAT A PULL REQUEST BUILD LEAVES. The last step of build-pr.yml's checks
// prints one line in its job's log, TESTED-TREE <tree> and the commit, the
// pull request and its head. It is the last step, so it is only there when
// every check before it passed. The gate harnesses run beside it in shares
// (31 Oct 2026), so the note counts only when every share of the same run
// passed too, and each was a share of the whole gate: since #5183 a pull
// request's shares run only what its change can reach, from main's nightly
// map, and then each says so in its name ("Gate harnesses (n of N, what the
// change reaches)"), and main builds and runs the whole gate. Since #5292
// the checks that need no Windows run in the job "Tree checks" on Linux, and
// the note counts only when that job passed in the same run too. Since
// #5293 the gate harnesses that need nothing from Windows run in shares on
// Linux ("Gate harnesses on Linux (n of N)"), counted the same way, and the
// run's "Build check result" job has to have passed as well, because it is
// what says no share was skipped for a reason the pick did not give. Until then
// it was
// written only when the gate step ran every gate harness (#3114: a pull
// request built on the VPS could run only those its change could reach, and
// then main built in full and was traced), and only on GitHub's hosted
// runner (#3874). It was an
// artifact, tested-tree-<tree>, until #3399: a private repository's artifact
// storage is counted by the hour, this one used October's whole allowance by
// 23 Oct 2026 (Patrick's billing report, on #3399), and from then every
// upload failed and took every pull request's build red with it. A log costs
// no storage, and GitHub keeps it 90 days.
//
// HOW IT IS FOUND. Main's HEAD is the squash merge of a pull request, and
// GitHub answers which pull request a commit came from. That pull request's
// head is the commit its build-pr.yml runs were made for, so its runs are
// read newest first, and the log of the one whose Launcher builds job got
// through its last step is read for the line.
//
// WHAT COUNTS AS TESTED. A TESTED-TREE line naming this tree, in the log of a
// Launcher builds job that ended success with its "Write down the tree these
// checks passed on" step success, beside every share of the gate ("Gate
// harnesses (n of N)" for each n, since 31 Oct 2026, each a share of the
// whole gate) ended success, in a run of .github/workflows/build-pr.yml
// for a pull_request whose head is this repository (a fork's run could name
// any tree it liked), for the head of a
// pull request merged as this commit. Anything less, or any answer from
// GitHub this cannot read, is "not tested", and main builds.
//
// THE MERGE QUEUE (#5182). Once main's ruleset puts pull requests in
// GitHub's merge queue, build-pr.yml runs again on the queue's merge of each
// one onto the newest main (a merge_group event, on a gh-readonly-queue/
// branch), and the pick runs the whole gate there. That merge is what lands
// on main, so before anything else this reads the newest passed merge_group
// runs of build-pr.yml and takes one whose commit is HEAD or whose commit's
// tree is HEAD's tree, under the same rules as below: Launcher builds through
// its last step, every share of the whole gate passed, and the tree in its
// log. A pull request's own run is still read after it, for a merge made
// before the queue.
//
// WHY THE TREE IS ENOUGH. actions/checkout fetches one commit, so a check
// sees the same files and no history on both builds; what differs is the
// commit's own id, message and date, the branch name and the event, and no
// check reads those (tests/test-3182-tested-tree.js holds that, and #3114
// has the run of every gate harness on a pull request checkout and a main
// checkout of one tree). The nightly runs every harness on main each night.
//
//     node scripts/dev/Tested-Tree.js --tree <sha> --commit <sha> --repo <owner/name>
//
// reads GH_TOKEN and writes run=<url> to GITHUB_OUTPUT when the tree passed.
// It always exits 0: a question it cannot answer builds main, it never fails it.
'use strict';

const WORKFLOW = '.github/workflows/build-pr.yml';
// One job since #4983. The box's fallback job never wrote the note (#3874),
// so its name never counted for anything and is not read.
const JOBS = ['Launcher builds'];
const STEP = 'Write down the tree these checks passed on';
// The checks of the tree that need no Windows run in a job of their own on
// Linux since 1 Nov 2026 (#5292), so the note counts only beside that job's
// success in the same run.
const CHECKS = 'Tree checks';
// The gate runs beside the launcher job in shares since 31 Oct 2026 (build.yml,
// the job "gate"): "Gate harnesses (n of N)", one job for each n from 1 to N,
// with ", what the change reaches" before the bracket when the pick gave the
// shares only that (#5183).
const GATE = /^Gate harnesses \((\d+) of (\d+)(, what the change reaches)?\)$/;

// The gate's Linux shares since #5293 (build.yml, the job "gate-linux"):
// "Gate harnesses on Linux (n of N)", the same way, for the harnesses the
// nightly map says need nothing from Windows.
const GATE_LINUX = /^Gate harnesses on Linux \((\d+) of (\d+)(, what the change reaches)?\)$/;
// The one check main's ruleset requires, written into build-pr.yml by
// scripts/dev/Build-PrWorkflow.js. It passes only when every job above it
// passed or was skipped for the reason the pick gave, so its success is what
// says a run's Linux shares were not skipped for any other reason: a matrix
// job that never started leaves no "(n of N)" job to read (#5293).
const RESULT = 'Build check result';

// '' when one platform's shares are all there and passed, or why not; none
// at all is '' here, and gateShares says whether that is enough.
function platformShares(jobs, re, where) {
  const shares = jobs.map(x => ({ m: re.exec(String(x && x.name || '')), x: x })).filter(s => s.m);
  if (shares.length === 0) { return ''; }
  const of = Number(shares[0].m[2]);
  const seen = new Set();
  for (const s of shares) {
    if (Number(s.m[2]) !== of) { return 'its gate shares' + where + ' do not agree how many there are'; }
    if (s.x.conclusion !== 'success') { return 'gate share ' + s.m[1] + ' of ' + of + where + ' did not pass'; }
    if (s.m[3]) { return 'its gate ran only what its change can reach, so main runs the whole gate'; }
    seen.add(Number(s.m[1]));
  }
  for (let n = 1; n <= of; n++) { if (!seen.has(n)) { return 'gate share ' + n + ' of ' + of + where + ' is not in it'; } }
  return shares.length === of ? '' : 'a share of its gate' + where + ' ran twice';
}

// '' when the run's jobs hold every share of the gate, on Windows and on
// Linux, each passed, or why not.
function gateShares(jobs) {
  const any = jobs.some(x => GATE.test(String(x && x.name || '')) || GATE_LINUX.test(String(x && x.name || '')));
  if (!any) { return 'no share of the gate ran in it'; }
  return platformShares(jobs, GATE, '') || platformShares(jobs, GATE_LINUX, ' on Linux');
}
const MARK = 'TESTED-TREE';
const SHA = /^[0-9a-f]{40}$/;

// Every tree a job's log says its checks passed on: the lines that start,
// after GitHub's timestamp, with the mark and a tree id.
function treesInLog(text) {
  const out = [];
  const re = new RegExp('^(?:\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z )?' + MARK + ' ([0-9a-f]{40})(?: |$)');
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) { out.push(m[1]); }
  }
  return out;
}

/*
  find({ tree, commit, repo, get, getText }) -> { run, why }
  get(path) resolves to the parsed JSON of GET https://api.github.com/<path>,
  getText(path) to its body as text (a job's log), or each throws. run is the
  passing run's address, or '' with why saying what was missing.
*/
async function find(o) {
  if (!SHA.test(String(o.tree || ''))) { return { run: '', why: 'no tree was given' }; }
  if (!SHA.test(String(o.commit || ''))) { return { run: '', why: 'no commit was given' }; }
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(o.repo || ''))) { return { run: '', why: 'no repository was given' }; }
  const whys = [];
  // A run of the merge queue (#5182) on this very commit, or on this tree.
  const queued = await o.get('repos/' + o.repo + '/actions/workflows/' + WORKFLOW.split('/').pop() + '/runs?event=merge_group&status=success&per_page=50');
  const groups = (queued && Array.isArray(queued.workflow_runs) ? queued.workflow_runs : []).filter(r => r &&
    (r.head_sha === o.commit || (r.head_commit && r.head_commit.tree_id === o.tree))).sort((a, b) => b.id - a.id);
  for (const r of groups) {
    const id = r.id;
    if (r.path !== WORKFLOW) { whys.push('run ' + id + ': not ' + WORKFLOW); continue; }
    if (r.event !== 'merge_group' || !/^gh-readonly-queue\//.test(String(r.head_branch || ''))) { whys.push('run ' + id + ': not a run of the merge queue'); continue; }
    if (!r.repository || r.repository.full_name !== o.repo || !r.head_repository || r.head_repository.full_name !== o.repo) {
      whys.push('run ' + id + ': its head is not this repository'); continue;
    }
    const got = await passedOn(o, r);
    if (got.tree) { return { run: String(r.html_url || ''), why: 'the merge queue\'s run ' + id + ' passed every check on this tree' }; }
    whys.push('run ' + id + ': ' + got.why);
  }
  if (groups.length === 0) { whys.push('no passed merge queue run of this commit or tree'); }
  const prs = await o.get('repos/' + o.repo + '/commits/' + o.commit + '/pulls?per_page=100');
  const merged = (Array.isArray(prs) ? prs : []).filter(p => p && p.merged_at && p.head && SHA.test(String(p.head.sha || '')) &&
    p.head.repo && p.head.repo.full_name === o.repo);
  if (merged.length === 0) { whys.push('no pull request of this repository was merged as ' + o.commit.slice(0, 12)); return { run: '', why: whys.join('; ') }; }
  for (const p of merged) {
    const list = await o.get('repos/' + o.repo + '/actions/workflows/' + WORKFLOW.split('/').pop() + '/runs?event=pull_request&head_sha=' + p.head.sha + '&per_page=100');
    const runs = (list && Array.isArray(list.workflow_runs) ? list.workflow_runs : []).filter(r => r && r.head_sha === p.head.sha).sort((a, b) => b.id - a.id);
    if (runs.length === 0) { whys.push('pull request #' + p.number + ': no pull request build of its head ' + p.head.sha.slice(0, 12)); continue; }
    for (const r of runs) {
      const id = r.id;
      if (r.path !== WORKFLOW) { whys.push('run ' + id + ': not ' + WORKFLOW); continue; }
      if (r.event !== 'pull_request') { whys.push('run ' + id + ': not a pull request build'); continue; }
      if (!r.repository || r.repository.full_name !== o.repo || !r.head_repository || r.head_repository.full_name !== o.repo) {
        whys.push('run ' + id + ': its head is not this repository'); continue;
      }
      const got = await passedOn(o, r);
      if (got.tree) {
        return { run: String(r.html_url || ''), why: 'pull request #' + p.number + ' passed every check on this tree' };
      }
      whys.push('run ' + id + ': ' + got.why);
    }
  }
  return { run: '', why: whys.join('; ') };
}

// { tree: true } when run r's Launcher builds job got through its last step,
// its Tree checks and Build check result jobs passed, every share of the
// whole gate beside it passed, and its log names o.tree; otherwise { why }.
async function passedOn(o, r) {
  const j = await o.get('repos/' + o.repo + '/actions/runs/' + r.id + '/jobs?per_page=100');
  const all = j && Array.isArray(j.jobs) ? j.jobs : [];
  const job = all.find(x =>
    JOBS.indexOf(x.name) >= 0 && x.conclusion === 'success' &&
    (Array.isArray(x.steps) ? x.steps : []).some(s => s.name === STEP && s.conclusion === 'success'));
  if (!job) { return { why: 'no Launcher builds job passed through to its last step' }; }
  if (!all.some(x => x && x.name === CHECKS && x.conclusion === 'success')) { return { why: 'its ' + CHECKS + ' job did not pass' }; }
  if (!all.some(x => x && x.name === RESULT && x.conclusion === 'success')) { return { why: 'its ' + RESULT + ' job did not pass' }; }
  const gate = gateShares(all);
  if (gate) { return { why: gate }; }
  const trees = treesInLog(await o.getText('repos/' + o.repo + '/actions/jobs/' + job.id + '/logs'));
  if (trees.indexOf(o.tree) >= 0) { return { tree: true }; }
  return { why: trees.length ? 'it passed on ' + trees.map(t => t.slice(0, 12)).join(', ') + ', another tree (main moved under it)' : 'its log has no ' + MARK + ' line' };
}

// GET https://api.github.com/<path>, as text. A job's log answers with a
// redirect to where GitHub keeps it, which fetch follows; the token is not
// sent on to that other host.
function api(token) {
  return async function getText(path) {
    const res = await fetch('https://api.github.com/' + path, {
      headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'thornswood-tested-tree' }
    });
    if (!res.ok) { throw new Error('GET ' + path.split('?')[0] + ' answered ' + res.status); }
    return res.text();
  };
}

async function main(argv, env, get) {
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? String(argv[i + 1] || '') : ''; };
  let r;
  const getText = get || api(env.GH_TOKEN || '');
  const getJson = async p => { const t = await getText(p); return typeof t === 'string' ? JSON.parse(t) : t; };
  try { r = await find({ tree: arg('--tree'), commit: arg('--commit'), repo: arg('--repo'), get: getJson, getText: async p => String(await getText(p)) }); }
  catch (e) { r = { run: '', why: 'GitHub could not be asked: ' + e.message }; }
  if (r.run) {
    console.log('Already tested: ' + r.why + ', ' + r.run + '. Main builds nothing again.');
    if (env.GITHUB_OUTPUT) { require('fs').appendFileSync(env.GITHUB_OUTPUT, 'run=' + r.run + '\n'); }
  } else {
    console.log('Not tested yet (' + r.why + '), so main builds in full.');
  }
  return r;
}

if (require.main === module) { main(process.argv.slice(2), process.env).then(() => process.exit(0), () => process.exit(0)); }
module.exports = { find: find, main: main, treesInLog: treesInLog, gateShares: gateShares, RESULT: RESULT, GATE_LINUX: GATE_LINUX, WORKFLOW: WORKFLOW, JOBS: JOBS, STEP: STEP, CHECKS: CHECKS, MARK: MARK, GATE: GATE };
