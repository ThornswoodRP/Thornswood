#!/usr/bin/env node
// Check-AppPermissions.js: does each GitHub App hold exactly what
// records/github-apps.json gives it (the redesign's part 20, plan line 26,
// 1 Nov 2026)?
//
//   node scripts/dev/Check-AppPermissions.js          read GitHub and compare
//   node scripts/dev/Check-AppPermissions.js -Record  check the record alone
//
// Run every night by .github/workflows/nightly.yml, step "Each GitHub App
// holds only what its record gives it", with GH_TOKEN set to the run's own
// token. For each App in the record it asks GitHub for GET /apps/<slug>,
// which says the permissions the App asks of every installation and the
// events it is sent, and prints one PASS or FAIL line per App:
//   - a permission the App holds that the record does not give it, or at a
//     higher level (write where the record says read): FAIL, since that is
//     more than its job needs;
//   - a permission the record gives that the App lacks, or holds lower:
//     FAIL, since its job will be refused;
//   - an event the App is sent that the record does not list, or the other
//     way round: FAIL;
//   - an App whose id is not the record's: FAIL, since the slug now names
//     another App;
//   - an App GitHub will not show: FAIL, with GitHub's answer.
// It exits 1 when any line failed, so the night is red and Nightly-Issue.ps1
// puts it on the board. The record's own rules (each App once, a why for
// every permission, levels read or write, Patrick's own agents never a Bot
// App) are checked first, and -Record checks only those.
//
// A change to an App's permissions is Patrick's, on the App's settings page,
// accepted on each installation; the record changes in a pull request first.
// Nothing here changes anything on GitHub or prints the token.
// tests/test-app-permissions.js runs this against a stand-in GitHub.
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const REPO = path.resolve(__dirname, '..', '..');
const RECORD = 'records/github-apps.json';
const LEVELS = { read: 1, write: 2, admin: 3 };

// The record's own rules. Returns a list of what is wrong; empty when it holds.
function checkRecord(doc) {
  const bad = [];
  const apps = doc && doc.apps;
  if (!Array.isArray(apps) || !apps.length) return [RECORD + ' names no apps'];
  const seen = {};
  const agents = Array.isArray(doc.patrick_agents) ? doc.patrick_agents : null;
  if (!agents) bad.push(RECORD + ' has no patrick_agents list (an empty one says Patrick has none)');
  const agentSlugs = (agents || []).map(a => String((a && a.slug) || '')).filter(Boolean);
  for (const a of apps) {
    const slug = String((a && a.slug) || '');
    if (!/^[a-z0-9][a-z0-9-]{0,33}$/.test(slug)) { bad.push(RECORD + ': an app has no slug GitHub could have (' + JSON.stringify(a && a.slug) + ')'); continue; }
    const at = RECORD + ', ' + slug;
    if (seen[slug]) bad.push(RECORD + ' names ' + slug + ' twice');
    seen[slug] = true;
    if (a.id !== undefined && !(Number.isInteger(a.id) && a.id > 0)) bad.push(at + ': id is a whole number, not ' + JSON.stringify(a.id));
    if (!String(a.for || '').trim()) bad.push(at + ': does not say what it is for');
    if (!String(a.held_by || '').trim()) bad.push(at + ': does not say who holds its key');
    if (agentSlugs.indexOf(slug) >= 0) bad.push(at + ' is also one of Patrick\'s own agents; a Bot App is never his agent');
    const perms = a.permissions;
    if (!perms || typeof perms !== 'object' || Array.isArray(perms)) { bad.push(at + ': no permissions'); continue; }
    if (perms.metadata !== 'read') bad.push(at + ': GitHub gives every App metadata read, so the record says metadata: read');
    const why = a.why || {};
    for (const k of Object.keys(perms)) {
      if (!LEVELS[perms[k]]) bad.push(at + ': ' + k + ' is ' + JSON.stringify(perms[k]) + ', not read or write');
      if (!String(why[k] || '').trim()) bad.push(at + ': ' + k + ' has no why');
    }
    for (const k of Object.keys(why)) if (!(k in perms)) bad.push(at + ': a why for ' + k + ', which it is not given');
    if (!Array.isArray(a.events)) bad.push(at + ': no events list (an empty one says none)');
    const evWhy = a.events_why || {};
    for (const e of Array.isArray(a.events) ? a.events : []) if (!String(evWhy[e] || '').trim()) bad.push(at + ': the ' + e + ' event has no why');
    for (const e of Object.keys(evWhy)) if (!Array.isArray(a.events) || a.events.indexOf(e) < 0) bad.push(at + ': an events_why for ' + e + ', which it is not sent');
    const on = Array.isArray(a.installed_on) ? a.installed_on : null;
    const off = Array.isArray(a.never_on) ? a.never_on : [];
    if (!on || !on.length) bad.push(at + ': does not say which repositories it is installed on');
    for (const r of on || []) if (off.indexOf(r) >= 0) bad.push(at + ' is both installed on and never on ' + r);
  }
  return bad;
}

// What differs between the record's entry and GitHub's App. [] when they agree.
function compare(rec, got) {
  const out = [];
  if (rec.id !== undefined && Number(got.id) !== rec.id) out.push('GitHub says ' + rec.slug + ' is App ' + got.id + ', and the record says ' + rec.id + '; the slug names another App now');
  const want = rec.permissions || {};
  const have = (got && got.permissions) || {};
  for (const k of Object.keys(have).sort()) {
    if (!(k in want)) out.push('holds ' + k + ' ' + have[k] + ', which the record does not give it');
    else if ((LEVELS[have[k]] || 0) > LEVELS[want[k]]) out.push('holds ' + k + ' ' + have[k] + ', and the record gives it ' + want[k]);
  }
  for (const k of Object.keys(want).sort()) {
    if (!(k in have)) out.push('lacks ' + k + ' ' + want[k] + ', which the record gives it');
    else if ((LEVELS[have[k]] || 0) < LEVELS[want[k]]) out.push('holds ' + k + ' ' + have[k] + ', and the record gives it ' + want[k]);
  }
  const ev = (got && Array.isArray(got.events)) ? got.events : [];
  const wantEv = rec.events || [];
  for (const e of ev.slice().sort()) if (wantEv.indexOf(e) < 0) out.push('is sent the ' + e + ' event, which the record does not list');
  for (const e of wantEv.slice().sort()) if (ev.indexOf(e) < 0) out.push('is not sent the ' + e + ' event, which the record lists');
  return out;
}

function get(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { 'User-Agent': 'thornswood-check-app-permissions', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = (u.protocol === 'http:' ? http : https).request(u, { method: 'GET', headers, timeout: 30000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) { json = null; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('no answer in 30 seconds')));
    req.on('error', reject);
    req.end();
  });
}

async function main(argv) {
  const recordOnly = argv.indexOf('-Record') >= 0;
  const file = process.env.THORNSWOOD_APPS_RECORD || path.join(REPO, RECORD);
  const api = (process.env.THORNSWOOD_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.log('FAIL  ' + RECORD + ' could not be read: ' + e.message);
    return 1;
  }
  const bad = checkRecord(doc);
  for (const b of bad) console.log('FAIL  ' + b);
  if (bad.length) return 1;
  console.log('PASS  ' + RECORD + ' holds its own rules (' + doc.apps.length + ' apps, ' + doc.patrick_agents.length + ' of Patrick\'s own agents apart)');
  if (recordOnly) return 0;
  let failed = 0;
  for (const rec of doc.apps) {
    let r;
    try { r = await get(api + '/apps/' + rec.slug, process.env.GH_TOKEN || ''); } catch (e) {
      console.log('FAIL  ' + rec.slug + ': GitHub did not answer (' + e.message + ')');
      failed++;
      continue;
    }
    if (r.status !== 200 || !r.body) {
      const said = (r.body && r.body.message) ? ': ' + r.body.message : '';
      console.log('FAIL  ' + rec.slug + ': GitHub answered ' + r.status + said + (r.status === 404 ? ' (no App by that name)' : r.status === 403 ? ' (a private App: a run\'s own token reads only a public one, measured 1 Nov 2026; it is made public on its Advanced settings page, as bramble, workers and the box admin App are)' : ''));
      failed++;
      continue;
    }
    const diff = compare(rec, r.body);
    if (!diff.length) {
      console.log('PASS  ' + rec.slug + ' (App ' + r.body.id + '): holds exactly what the record gives it: ' +
        Object.keys(rec.permissions).sort().map(k => k + ' ' + rec.permissions[k]).join(', ') + (rec.events.length ? '; events ' + rec.events.join(', ') : '; no events'));
      if (rec.id === undefined) console.log('      ' + rec.slug + ' is App ' + r.body.id + '; the record can say so');
    } else {
      for (const d of diff) console.log('FAIL  ' + rec.slug + ' ' + d);
      failed++;
    }
  }
  console.log('');
  console.log(failed ? failed + ' of ' + doc.apps.length + ' apps differ from ' + RECORD + '. The fix is Patrick\'s, on each App\'s settings page, or a pull request to the record when the job really changed.' : 'every app holds exactly what ' + RECORD + ' gives it');
  return failed ? 1 : 0;
}

module.exports = { checkRecord, compare };

if (require.main === module) {
  main(process.argv.slice(2)).then(code => process.exit(code), e => { console.log('FAIL  ' + e.message); process.exit(1); });
}
