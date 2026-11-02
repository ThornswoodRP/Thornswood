#!/usr/bin/env node
// scripts/release/After-Deploy.js
//
// #5186: what a Deployment's steps after a deploy leave for people. The box
// deploy agent runs each step a pull request put under deploy/after/ once,
// after the Deployment succeeds, and leaves what became of each beside the
// Deployment's log as deploy-<id>.after.json (tools/DeployAgent/AfterDeploy.cs).
// .github/workflows/after-deploy.yml runs this on that Deployment's success:
//
//   - each in-game check the agent listed becomes an issue labelled
//     "check: in game", once;
//   - each step that failed or was cut short is said on its own issue,
//     once for each Deployment.
//
// WHAT IS TRUSTED. The agent's file says only which step had which result.
// The words of an issue come from the step files of this checkout, which is
// the Deployment's own commit, so nothing read off the box's web port is
// ever written into an issue. A result that names a step this commit does
// not hold, or a file for another Deployment or commit, is refused.
//
//     node scripts/release/After-Deploy.js
//
// reads DEPLOYMENT, COMMIT, ENVIRONMENT, LOG_URL, REPO and GH_TOKEN. Exits 0
// when it said all it had to, 1 when GitHub or the box would not answer.
'use strict';
const fs = require('fs');
const path = require('path');

const LABEL = 'check: in game';
const FOLDER = path.join('deploy', 'after');
const ID = /^([1-9][0-9]{0,5}-[a-z0-9]+(?:-[a-z0-9]+)*)#([1-9][0-9]?)$/;

// Every step of every file under deploy/after in a checkout, by id.
function readSteps(repo) {
  const out = new Map();
  const dir = path.join(repo, FOLDER);
  if (!fs.existsSync(dir)) { return out; }
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    let f;
    try { f = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (e) { continue; }
    (Array.isArray(f.steps) ? f.steps : []).forEach((s, i) => {
      out.set(name.slice(0, -5) + '#' + (i + 1), { issue: f.issue, environment: f.environment, step: s || {} });
    });
  }
  return out;
}

// The line an issue carries that says which step it is, so it is filed once.
function marker(id) { return 'Step ' + id + ' of deploy/after.'; }

function issueFor(id, s, o) {
  const text = String(s.step.inGame || '').trim();
  const title = 'Check in game: ' + (text.length > 80 ? text.slice(0, 77).replace(/\s+\S*$/, '') + '...' : text);
  const body = [
    text,
    'On ' + o.environment + ' since the deploy of ' + o.commit.slice(0, 12) + ', from #' + s.issue + '. ' + marker(id),
    'Done when: ' + String(s.step.doneWhen || '').trim(),
  ].join('\n\n');
  return { title: title, body: body, labels: [LABEL] };
}

function failureComment(id, r, s, o) {
  const what = r.state === 'cut-short'
    ? 'was cut short: the deploy agent stopped while it ran, and it is never run a second time'
    : 'failed, exit ' + r.code;
  return [
    'The step after the deploy to ' + o.environment + ', `' + String(s.step.run || '') + '`, ' + what + ' (Deployment ' + o.deployment + ', ' + marker(id) + ').',
    'The deploy itself is in. The log: ' + o.logUrl,
    'Done when: a fix carries a new step file for what this one did, and it runs.',
  ].join('\n\n');
}

/*
  act({ after, steps, deployment, commit, environment, logUrl, gh }) -> lines said
  after is the agent's deploy-<id>.after.json, parsed; steps is readSteps()
  of the Deployment's commit; gh holds async issues(label), create(issue),
  comments(number), comment(number, body), label(name).
*/
async function act(o) {
  const said = [];
  const a = o.after || {};
  if (String(a.deployment) !== String(o.deployment)) { throw new Error('the file is for deployment ' + a.deployment + ', not ' + o.deployment); }
  if (a.commit !== o.commit) { throw new Error('the file is for commit ' + a.commit + ', not ' + o.commit); }
  const results = Array.isArray(a.steps) ? a.steps : [];
  const games = results.filter(r => r && r.state === 'in-game');
  const bad = results.filter(r => r && (r.state === 'failure' || r.state === 'cut-short'));
  if (games.length) {
    await o.gh.label(LABEL);
    const open = await o.gh.issues(LABEL);
    for (const r of games) {
      const s = o.steps.get(r.id);
      if (!ID.test(String(r.id)) || !s || !s.step.inGame || s.environment !== o.environment) { said.push('REFUSED ' + r.id + ': this commit has no in-game step for ' + o.environment + ' by that id'); continue; }
      const have = open.find(i => String(i.body || '').indexOf(marker(r.id)) >= 0);
      if (have) { said.push(r.id + ': already #' + have.number); continue; }
      const made = await o.gh.create(issueFor(r.id, s, o));
      said.push(r.id + ': filed #' + made.number);
    }
  }
  for (const r of bad) {
    const s = o.steps.get(r.id);
    if (!ID.test(String(r.id)) || !s || !s.step.run || s.environment !== o.environment) { said.push('REFUSED ' + r.id + ': this commit has no run step for ' + o.environment + ' by that id'); continue; }
    const n = Number(s.issue);
    const mark = 'Deployment ' + o.deployment + ', ' + marker(r.id);
    const have = await o.gh.comments(n);
    if (have.some(c => String(c.body || '').indexOf(mark) >= 0)) { said.push(r.id + ': already said on #' + n); continue; }
    await o.gh.comment(n, failureComment(r.id, r, s, o));
    said.push(r.id + ': said on #' + n + ' that it ' + (r.state === 'cut-short' ? 'was cut short' : 'failed'));
  }
  if (!games.length && !bad.length) { said.push('nothing for people: ' + results.length + ' step(s), none failed and none is in game'); }
  return said;
}

function github(repo, token) {
  const base = 'https://api.github.com/repos/' + repo;
  async function call(method, p, body, ok404) {
    const res = await fetch(base + p, {
      method: method,
      headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'thornswood-after-deploy' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (ok404 && res.status === 404) { return null; }
    if (!res.ok) { throw new Error(method + ' ' + p + ' answered ' + res.status); }
    return res.status === 204 ? null : res.json();
  }
  async function all(p) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const got = await call('GET', p + (p.indexOf('?') >= 0 ? '&' : '?') + 'per_page=100&page=' + page);
      out.push(...got);
      if (got.length < 100) { break; }
    }
    return out;
  }
  return {
    label: async name => { if (!(await call('GET', '/labels/' + encodeURIComponent(name), null, true))) { await call('POST', '/labels', { name: name, color: '5319e7', description: 'A check a person makes in the game after a deploy (#5186)' }); } },
    issues: label => all('/issues?state=all&labels=' + encodeURIComponent(label)),
    create: issue => call('POST', '/issues', issue),
    comments: n => all('/issues/' + n + '/comments'),
    comment: (n, body) => call('POST', '/issues/' + n + '/comments', { body: body }),
  };
}

async function main() {
  const e = process.env;
  for (const k of ['DEPLOYMENT', 'COMMIT', 'ENVIRONMENT', 'LOG_URL', 'REPO', 'GH_TOKEN']) {
    if (!e[k]) { console.log('::error::' + k + ' is not set'); process.exit(1); }
  }
  if (!/\/deploy-[0-9]+\.log$/.test(e.LOG_URL)) { console.log('The Deployment\'s log is not a deploy agent\'s, so no steps ran with it.'); return; }
  const url = e.LOG_URL.replace(/\.log$/, '.after.json');
  const res = await fetch(url);
  if (res.status === 404) { console.log('No steps after the deploy ran with Deployment ' + e.DEPLOYMENT + ' (' + url + ' is not there).'); return; }
  if (!res.ok) { console.log('::error::' + url + ' answered ' + res.status); process.exit(1); }
  const said = await act({
    after: await res.json(), steps: readSteps(path.join(__dirname, '..', '..')),
    deployment: e.DEPLOYMENT, commit: e.COMMIT, environment: e.ENVIRONMENT, logUrl: e.LOG_URL, gh: github(e.REPO, e.GH_TOKEN),
  });
  for (const l of said) { console.log(l); }
}

if (require.main === module) { main().catch(err => { console.log('::error::' + err.message); process.exit(1); }); }
module.exports = { act: act, readSteps: readSteps, issueFor: issueFor, failureComment: failureComment, marker: marker, LABEL: LABEL };
