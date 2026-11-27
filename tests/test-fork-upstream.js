// test-fork-upstream.js
//
//     node tests\test-fork-upstream.js
//
// The fork has every commit upstream SkyMP has, or says why not (issue #1791).
// tests\test-engine-at-fork-head.js holds our pin to the head of the fork
// branch; nothing watched the level above it, upstream skyrim-multiplayer/skymp
// against the fork, so a fix upstream made sat there until somebody happened
// to look. On 5 Oct upstream main had two commits from that day the fork did
// not, one of them a client fix for a hang at exit. Patrick, 5 Oct: yes, the
// nightly goes red when upstream SkyMP has fixes the fork does not. It is the
// rule he set for fork changes on 29 Sep ("What's the point in the changes if
// we aren't using them"), one level up.
//
// It asks over git (tests\fork-git.js, #3052) for the commits on upstream
// main, from the upstream named in records\server-build.json, that the fork
// branch .gitmodules follows does not have: the ones on upstream main since
// the two last met.
//   none (identical, or the fork is only ahead)   pass
//   each one in records\upstream-not-taken.json with a reason
//                                                 pass, naming them
//   any other                                     fail, naming each one
// It goes green when the commit is merged into the fork (a fork pull request,
// then a build and new records here, engine/README.md "One engine"), or when
// records\upstream-not-taken.json says that commit is not being taken and why.
// An entry with no reason, or a sha that is not a full one, is a fail: a
// turn-down nobody can read is not one. It asked GitHub's REST compare API
// signed out until 21 Oct, which allows 60 requests an hour per address and
// failed on every shared one (a cloud thread), and listed at most 250
// commits; git's own fetch is under neither limit and needs no token, both
// repositories being public. No answer is a fail, not a skip: a check that
// did not happen is the failure this exists to stop. It needs the network,
// so it runs in the nightly checks and not in the build check on every pull
// request.
//
// The network is stood in for, so the logic is checked offline, by:
//   THORNSWOOD_UPSTREAM_COMPARE_JSON  a path to a saved comparison (status,
//                                     ahead_by, behind_by, commits), read
//                                     instead of asking
//   THORNSWOOD_UPSTREAM_NOT_TAKEN     a path to another record file
// and by the made up answers below, which run every time, network or not.
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const forkGit = require('./fork-git');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const RECORD = process.env.THORNSWOOD_UPSTREAM_NOT_TAKEN || path.join(REPO, 'records', 'upstream-not-taken.json');
// Upstream's own branch. The records name upstream's address and the merge
// base, not a branch, and skyrim-multiplayer/skymp works on main.
const UPSTREAM_BRANCH = 'main';

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function git(args) {
  return execFileSync('git', ['-C', REPO].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function line(c) {
  return String(c.sha || '').slice(0, 8) + ' ' + String((c.commit && c.commit.message) || '').split('\n')[0];
}

// The record, as { notTaken: Map sha -> why, bad: [what is wrong with a line] }.
function readNotTaken(text) {
  const out = { notTaken: new Map(), bad: [] };
  let rec;
  try { rec = JSON.parse(text); } catch (e) { out.bad.push('it is not JSON (' + e.message + ')'); return out; }
  if (!rec || !Array.isArray(rec.commits)) { out.bad.push('it has no "commits" list'); return out; }
  rec.commits.forEach(function (c, i) {
    const sha = String((c && c.sha) || '');
    const why = String((c && c.why) || '').trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) { out.bad.push('entry ' + (i + 1) + ' names "' + sha + '", not a full commit sha'); return; }
    if (!why) { out.bad.push('entry ' + (i + 1) + ' (' + sha.slice(0, 8) + ') says no reason'); return; }
    out.notTaken.set(sha, why);
  });
  return out;
}

// What a compare answer (base the fork branch, head upstream main) says, as
// { ok, why, missing, turnedDown }.
function verdict(cmp, notTaken) {
  if (!cmp || typeof cmp.status !== 'string') { return { ok: false, why: 'no comparison was made', missing: [], turnedDown: [] }; }
  const commits = Array.isArray(cmp.commits) ? cmp.commits : [];
  const ahead = Number(cmp.ahead_by) || 0;
  if (cmp.status === 'identical' || ahead === 0) {
    return { ok: true, why: 'the fork has every commit on upstream ' + UPSTREAM_BRANCH, missing: [], turnedDown: [] };
  }
  const missing = commits.filter(function (c) { return !notTaken.has(String(c.sha || '')); });
  const turnedDown = commits.filter(function (c) { return notTaken.has(String(c.sha || '')); });
  if (missing.length === 0) {
    return { ok: true, why: ahead + ' upstream commit(s) not in the fork, each turned down in records\\upstream-not-taken.json', missing: [], turnedDown: turnedDown };
  }
  return { ok: false, why: missing.length + ' upstream commit(s) are not in the fork and not turned down: ' + missing.map(line).join('; '), missing: missing, turnedDown: turnedDown };
}

// ---- the rule, on made up answers ------------------------------------------
const A = 'f84a1940' + '0'.repeat(32), B = 'c13bd7b6' + '1'.repeat(32);
function commit(sha, msg) { return { sha: sha, commit: { message: msg + '\n\nbody' } }; }
const none = new Map();
yes('identical passes', verdict({ status: 'identical', ahead_by: 0, behind_by: 0, commits: [] }, none).ok);
yes('the fork only ahead of upstream passes', verdict({ status: 'behind', ahead_by: 0, behind_by: 93, commits: [] }, none).ok);
const two = { status: 'diverged', ahead_by: 2, behind_by: 93, commits: [commit(A, 'fix(client): skip the RakNet shutdown'), commit(B, 'internal: remove 1js include directory')] };
let v = verdict(two, none);
yes('upstream commits the fork does not have fail', !v.ok);
yes('  naming each one by sha and subject', /f84a1940 fix\(client\): skip the RakNet shutdown/.test(v.why) && /c13bd7b6 internal: remove 1js/.test(v.why));
v = verdict(two, new Map([[B, 'a build change for a folder we do not build']]));
yes('one turned down, one not: still a fail, naming only the one not turned down', !v.ok && v.missing.length === 1 && /f84a1940/.test(v.why) && !/c13bd7b6/.test(v.why));
v = verdict(two, new Map([[A, 'taken by hand as fork commit 1234abcd'], [B, 'nothing we build']]));
yes('every one turned down with a reason passes', v.ok && v.turnedDown.length === 2);
yes('a fork that is ahead and behind (diverged) is judged by what it lacks', !verdict(Object.assign({}, two, { status: 'ahead' }), none).ok);
yes('no answer fails', !verdict(null, none).ok);
yes('an answer with no status fails', !verdict({ message: 'API rate limit exceeded' }, none).ok);

let r = readNotTaken(JSON.stringify({ commits: [{ sha: A, subject: 'fix(client)', why: 'taken by hand', decided: 'Patrick, 5 Oct' }] }));
yes('a record line with a full sha and a reason counts', r.bad.length === 0 && r.notTaken.get(A) === 'taken by hand');
r = readNotTaken(JSON.stringify({ commits: [{ sha: A, why: '  ' }] }));
yes('a record line with no reason does not count, and is a fault', r.notTaken.size === 0 && r.bad.length === 1 && /no reason/.test(r.bad[0]));
r = readNotTaken(JSON.stringify({ commits: [{ sha: 'f84a1940', why: 'short' }] }));
yes('a short sha does not count, and is a fault', r.notTaken.size === 0 && /not a full commit sha/.test(r.bad[0]));
yes('a record that is not JSON is a fault', readNotTaken('{ commits: [').bad.length === 1);

// ---- the fork and upstream, as this checkout names them ---------------------
// Base the fork branch, head upstream main: what comes back is on upstream
// and not on the fork.
function askUpstream(forkUrl, branch, upstreamUrl) {
  const repo = forkGit.open('fork-upstream');
  try {
    repo.fetch('fork', forkUrl, ['+refs/heads/' + branch + ':refs/compare/fork']);
    repo.fetch('upstream', upstreamUrl, ['+refs/heads/' + UPSTREAM_BRANCH + ':refs/compare/upstream']);
    return repo.compare('refs/compare/fork', 'refs/compare/upstream');
  } finally { repo.close(); }
}

async function main() {
  let url = '', branch = '', upstream = '';
  try {
    url = git(['config', '-f', '.gitmodules', '--get', 'submodule.engine/skymp.url']);
    branch = git(['config', '-f', '.gitmodules', '--get', 'submodule.engine/skymp.branch']);
  } catch (e) { /* each is checked below */ }
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'server-build.json'), 'utf8'));
    upstream = String((rec.source && rec.source.upstream) || '');
  } catch (e) { /* checked below */ }
  const fork = /github\.com[/:]([^/]+)\/([^/]+?)(\.git)?\/?$/.exec(url);
  const up = /github\.com[/:]([^/]+)\/([^/]+?)(\.git)?\/?$/.exec(upstream);
  yes('.gitmodules names a GitHub fork and a branch (' + url + ', ' + branch + ')', !!(fork && branch));
  yes('records\\server-build.json names the upstream it came from (' + upstream + ')', !!up);

  let text = null;
  try { text = fs.readFileSync(RECORD, 'utf8'); } catch (e) { /* checked below */ }
  yes('records\\upstream-not-taken.json is there', text !== null);
  const rec = readNotTaken(text || '');
  yes('and every line in it has a full sha and a reason' + (rec.bad.length ? ' (' + rec.bad.join('; ') + ')' : ' (' + rec.notTaken.size + ' turned down)'),
    text !== null && rec.bad.length === 0);
  if (!fork || !branch || !up) { return; }

  let cmp = null;
  const saved = process.env.THORNSWOOD_UPSTREAM_COMPARE_JSON;
  try {
    cmp = saved ? JSON.parse(fs.readFileSync(saved, 'utf8'))
      : askUpstream(url, branch, 'https://github.com/' + up[1] + '/' + up[2]);
  } catch (e) {
    console.log('      ' + (e && e.message || e));
    cmp = null;
  }
  const v = verdict(cmp, rec.notTaken);
  console.log('      ' + v.why);
  v.turnedDown.forEach(function (c) { console.log('      turned down: ' + line(c) + ': ' + rec.notTaken.get(c.sha)); });
  yes('upstream ' + up[1] + '/' + up[2] + ' ' + UPSTREAM_BRANCH + ' has nothing ' + branch + ' lacks that is not turned down', v.ok);
  if (!v.ok && cmp) {
    console.log('');
    console.log('  Merge each into ' + branch + ' (a fork pull request, then a build and new');
    console.log('  records here, engine/README.md "One engine"), or add it to');
    console.log('  records\\upstream-not-taken.json with why it is not being taken.');
  }
}

main().then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}).catch(function (e) {
  console.log('FAIL  ' + String(e && e.stack || e).replace(/\n/g, '\n      '));
  process.exitCode = 1;
});
