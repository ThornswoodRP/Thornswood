#!/usr/bin/env node
// scripts/ops/Box-Step.js
//
// #5611: an issue whose Done when is a step on the box closes on that step's
// own output, never on the merge before it.
//
// WHY. On 9 Nov 2026 #5181's last step, Install-DeployAgent -Main, turned out
// never to have run though its pull request merged on 1 Nov, and main's
// releases sat unapplied for a week. The audit on #5611 then found box steps
// nobody saw run on seven closed issues, live voice among them (#5610). Two
// things closed them: 36 issues closed on 30 and 31 Oct with "This is done on
// main", which checks the merge, not the box; and a pull request saying
// "Fixes #N", which closes the issue at the merge, before the step after it.
// Both check the code. Nothing checked the box.
//
// WHAT IT DOES. .github/workflows/box-step.yml runs this:
//   - on an issue opened or edited: when its Done when (or Needs) names a
//     step on the box, a verb of scripts/vps/gate/verbs.json or the words
//     "on the box", "box step" or Box-Run, it puts the label "box step" on.
//     A person may put the label on by hand too; this never takes it off.
//   - on an issue closed as done: when it carries "box step", or a step file
//     under deploy/after names it with a step to run (it is labelled then),
//     and no comment
//     whose first line starts "Box step output:", it opens the issue again
//     and says why, once for each close.
//   - each day, and when started by hand: the same for every issue closed in
//     the last two days, so a close no event reached is caught as well.
// A comment starting "Box step output:" holds what the step printed: the
// gate's run, the Deployment's log, the ENDED line. The deploy agent's steps
// after a deploy (deploy/after) write it by themselves when their step ends
// 0 (scripts/release/After-Deploy.js). docs/guide/the-board.md has the rule.
//
//     node scripts/ops/Box-Step.js
//
// reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY and GH_TOKEN.
'use strict';
const fs = require('fs');
const path = require('path');

const LABEL = 'box step';
const OUTPUT = 'Box step output:';

// The lines of an issue's body that say what finishes it: a "Done when" or
// "Needs" line, or the paragraph under a "Done when" heading.
function doneWhen(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^[#>*\s-]+/, '');
    if (!/^(done when|needs)\b/i.test(l)) { continue; }
    const rest = l.replace(/^(done when|needs)\b[:\s]*/i, '').trim();
    if (rest) { out.push(rest); continue; }
    // A heading: the paragraph under it.
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) { j++; }
    while (j < lines.length && lines[j].trim() && !/^#/.test(lines[j])) { out.push(lines[j].trim()); j++; }
  }
  return out.join('\n');
}

function verbNames(repo) {
  const v = JSON.parse(fs.readFileSync(path.join(repo, 'scripts', 'vps', 'gate', 'verbs.json'), 'utf8'));
  return Object.keys(v.verbs || {});
}

// What in the Done when names a step on the box, or '' when nothing does.
function namesBoxStep(body, verbs) {
  const d = doneWhen(body);
  if (!d) { return ''; }
  for (const v of verbs) {
    const re = new RegExp('(^|[^A-Za-z0-9-])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\.ps1)?($|[^A-Za-z0-9-])');
    if (re.test(d)) { return v; }
  }
  const m = d.match(/\b(on the box|box step|Box-Run)\b/i);
  return m ? m[1] : '';
}

// The issues a step file under deploy/after names with a step to run: each
// is a box step whatever its Done when says.
function stepIssues(repo) {
  const out = new Set();
  const dir = path.join(repo, 'deploy', 'after');
  if (!fs.existsSync(dir)) { return out; }
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
    let f;
    try { f = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (e) { continue; }
    if (Number.isInteger(f.issue) && (Array.isArray(f.steps) ? f.steps : []).some(x => x && x.run)) { out.add(f.issue); }
  }
  return out;
}

function hasOutput(comments) {
  return comments.some(c => String(c.body || '').replace(/^\s+/, '').startsWith(OUTPUT));
}

// Why the close stands, or '' when the issue opens again.
function closeStands(issue, comments) {
  const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name));
  if (labels.indexOf(LABEL) < 0) { return 'not a box step'; }
  if (issue.state_reason === 'not_planned' || issue.state_reason === 'duplicate') { return 'closed as ' + issue.state_reason; }
  if (hasOutput(comments)) { return 'the step\'s output is on it'; }
  return '';
}

const REOPEN = [
  'Opened again: its Done when is a step on the box, and it closes on that step\'s own output, not on a merge.',
  'Put what the step printed in a comment whose first line starts "' + OUTPUT + '" (the gate run or the Deployment log, and its ENDED line), then close it. A step file under deploy/after writes that comment by itself when its step runs.',
].join('\n\n');

function github(repo, token) {
  const base = 'https://api.github.com/repos/' + repo;
  async function call(method, p, body, ok404) {
    const res = await fetch(base + p, {
      method: method,
      headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'thornswood-box-step' },
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
    label: async () => { if (!(await call('GET', '/labels/' + encodeURIComponent(LABEL), null, true))) { await call('POST', '/labels', { name: LABEL, color: 'b60205', description: 'Its Done when is a step on the box; it closes on that step\'s output (#5611)' }); } },
    addLabel: n => call('POST', '/issues/' + n + '/labels', { labels: [LABEL] }),
    issue: n => call('GET', '/issues/' + n),
    closedSince: since => all('/issues?state=closed&labels=' + encodeURIComponent(LABEL) + '&since=' + encodeURIComponent(since)),
    comments: n => all('/issues/' + n + '/comments'),
    comment: (n, body) => call('POST', '/issues/' + n + '/comments', { body: body }),
    reopen: n => call('PATCH', '/issues/' + n, { state: 'open' }),
  };
}

/*
  act({ event, payload, verbs, steps, gh, now }) -> lines said
  steps is stepIssues() of main, the issues deploy/after names.
  gh holds async label(), addLabel(n), issue(n), closedSince(iso),
  comments(n), comment(n, body), reopen(n).
*/
async function act(o) {
  const said = [];
  const p = o.payload || {};
  const one = async (issue) => {
    if (issue.pull_request) { return; }
    const labelled = (issue.labels || []).some(l => (typeof l === 'string' ? l : l.name) === LABEL);
    if (!labelled && o.steps && o.steps.has(issue.number)) {
      await o.gh.label();
      await o.gh.addLabel(issue.number);
      issue = Object.assign({}, issue, { labels: (issue.labels || []).concat([{ name: LABEL }]) });
      said.push('#' + issue.number + ': labelled "' + LABEL + '", a step file under deploy/after names it');
    }
    // Comments are read only for an issue whose close could fall.
    let why = closeStands(issue, [{ body: OUTPUT }]);
    if (why === 'the step\'s output is on it') { why = closeStands(issue, await o.gh.comments(issue.number)); }
    if (why) { said.push('#' + issue.number + ': the close stands, ' + why); return; }
    await o.gh.reopen(issue.number);
    await o.gh.comment(issue.number, REOPEN);
    said.push('#' + issue.number + ': opened again, no "' + OUTPUT + '" comment');
  };
  if (o.event === 'issues' && (p.action === 'opened' || p.action === 'edited')) {
    const i = p.issue || {};
    if (i.pull_request) { return said; }
    const what = namesBoxStep(i.body, o.verbs);
    const has = (i.labels || []).some(l => l.name === LABEL);
    if (what && !has) {
      await o.gh.label();
      await o.gh.addLabel(i.number);
      said.push('#' + i.number + ': labelled "' + LABEL + '", its Done when names ' + what);
    } else {
      said.push('#' + i.number + ': ' + (has ? 'already labelled' : 'its Done when names no step on the box'));
    }
  } else if (o.event === 'issues' && p.action === 'closed') {
    await one(p.issue || {});
  } else if (o.event === 'schedule' || o.event === 'workflow_dispatch') {
    const since = new Date(o.now - 2 * 24 * 3600 * 1000).toISOString();
    for (const i of await o.gh.closedSince(since)) {
      if (i.closed_at && Date.parse(i.closed_at) < Date.parse(since)) { continue; }
      await one(i);
    }
    if (!said.length) { said.push('no issue labelled "' + LABEL + '" closed since ' + since); }
  } else {
    said.push('nothing to do for ' + o.event + ' ' + (p.action || ''));
  }
  return said;
}

async function main() {
  const e = process.env;
  for (const k of ['GITHUB_EVENT_NAME', 'GITHUB_EVENT_PATH', 'GITHUB_REPOSITORY', 'GH_TOKEN']) {
    if (!e[k]) { console.log('::error::' + k + ' is not set'); process.exit(1); }
  }
  const said = await act({
    event: e.GITHUB_EVENT_NAME,
    payload: JSON.parse(fs.readFileSync(e.GITHUB_EVENT_PATH, 'utf8')),
    verbs: verbNames(path.join(__dirname, '..', '..')),
    steps: stepIssues(path.join(__dirname, '..', '..')),
    gh: github(e.GITHUB_REPOSITORY, e.GH_TOKEN),
    now: Date.now(),
  });
  for (const l of said) { console.log(l); }
}

if (require.main === module) { main().catch(err => { console.log('::error::' + err.message); process.exit(1); }); }
module.exports = { act, doneWhen, namesBoxStep, hasOutput, closeStands, verbNames, stepIssues, LABEL, OUTPUT, REOPEN };
