// The redesign's part 20 (plan line 26, 1 Nov 2026): every GitHub App that
// works on Thornswood's repositories holds exactly what
// records/github-apps.json gives it, checked every night by
// scripts/dev/Check-AppPermissions.js.
//
// This checks:
//   1. the real record holds its own rules, and the record's rules refuse an
//      App named twice, a permission with no why or at a level GitHub does
//      not have, a why for a permission not given, no metadata read, no
//      events list, an event with no why or a why for an event not sent,
//      an App that is also one of Patrick's own agents, and a
//      repository both installed on and never on;
//   2. the comparison: an extra permission, a higher level, a missing one, a
//      lower level, an extra or missing event, and another App behind the
//      slug are each named, and an App that matches names nothing;
//   3. the script run for real against a stand-in GitHub on loopback: all
//      matching passes with exit 0, one App holding more fails with exit 1
//      and names it, one GitHub will not show fails, and the token it is
//      given reaches GitHub as a bearer token and is never printed;
//   4. nightly.yml runs it, on main, with the run's own token.
// Nothing here reaches GitHub.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'dev', 'Check-AppPermissions.js');
const { checkRecord, compare } = require(SCRIPT);

let pass = 0;
let fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

const real = JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'github-apps.json'), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));

// 1. the record's rules
console.log('1. the record');
yes('the real records/github-apps.json holds its own rules', checkRecord(real).length === 0);
yes('  it names the six Bots\' two Apps, the box admin App, the watcher, the pin robot and the board App',
  ['thornswood-bramble', 'thornswood-workers', 'thornswood-box-admin', 'thornswood-watch', 'thornswood-pin-robot', 'thornswood-board'].every(s => real.apps.some(a => a.slug === s)));
yes('  only Bramble\'s App may change a workflow', real.apps.filter(a => a.permissions.workflows).map(a => a.slug).join() === 'thornswood-bramble');
yes('  no App holds administration but the box admin App and the watcher (read)',
  real.apps.filter(a => a.permissions.administration).map(a => a.slug + ' ' + a.permissions.administration).sort().join() === 'thornswood-box-admin write,thornswood-watch read');
yes('  no App may write a secret, and only the box admin App an environment', real.apps.every(a => a.permissions.secrets !== 'write') && real.apps.filter(a => a.permissions.environments === 'write').map(a => a.slug).join() === 'thornswood-box-admin');
yes('  only Bramble\'s App is sent events: check_suite and pull_request, to wake it', real.apps.filter(a => a.events.length).map(a => a.slug + ' ' + a.events.join('+')).join() === 'thornswood-bramble check_suite+pull_request');
yes('  no Bot App is installed on Thornswood-Hermes', real.apps.every(a => (a.installed_on || []).indexOf('ThornswoodRP/Thornswood-Hermes') < 0));
const bad = (what, change) => { const d = clone(real); change(d); return checkRecord(d).some(l => what.test(l)); };
yes('an App named twice is refused', bad(/names thornswood-bramble twice/, d => d.apps.push(clone(d.apps[0]))));
yes('a permission with no why is refused', bad(/issues has no why/, d => { delete d.apps[0].why.issues; }));
yes('a level GitHub does not have is refused', bad(/issues is "all", not read or write/, d => { d.apps[0].permissions.issues = 'all'; }));
yes('a why for a permission not given is refused', bad(/a why for packages/, d => { d.apps[0].why.packages = 'x'; }));
yes('no metadata read is refused', bad(/metadata: read/, d => { delete d.apps[0].permissions.metadata; delete d.apps[0].why.metadata; }));
yes('no events list is refused', bad(/no events list/, d => { delete d.apps[0].events; }));
yes('an event with no why is refused', bad(/the check_suite event has no why/, d => { delete d.apps[0].events_why.check_suite; }));
yes('a why for an event not sent is refused', bad(/an events_why for push/, d => { d.apps[0].events_why.push = 'x'; }));
yes('an App that is also one of Patrick\'s agents is refused', bad(/is also one of Patrick's own agents/, d => { d.patrick_agents.push({ name: 'x', slug: 'thornswood-workers', why: 'x' }); }));
yes('no patrick_agents list is refused', bad(/no patrick_agents list/, d => { delete d.patrick_agents; }));
yes('a repository both installed on and never on is refused', bad(/both installed on and never on ThornswoodRP\/Thornswood/, d => { d.apps[0].never_on.push('ThornswoodRP/Thornswood'); }));

// 2. the comparison
console.log('2. the comparison');
const rec = { slug: 'x', id: 7, permissions: { contents: 'write', issues: 'read', metadata: 'read' }, events: [] };
const same = { id: 7, permissions: { contents: 'write', issues: 'read', metadata: 'read' }, events: [] };
yes('an App that matches names nothing', compare(rec, same).length === 0);
const more = clone(same); more.permissions.administration = 'write';
yes('an extra permission is named', compare(rec, more).join() === 'holds administration write, which the record does not give it');
const higher = clone(same); higher.permissions.issues = 'write';
yes('a higher level is named', compare(rec, higher).join() === 'holds issues write, and the record gives it read');
const missing = clone(same); delete missing.permissions.contents;
yes('a missing permission is named', compare(rec, missing).join() === 'lacks contents write, which the record gives it');
const lower = clone(same); lower.permissions.contents = 'read';
yes('a lower level is named', compare(rec, lower).join() === 'holds contents read, and the record gives it write');
const ev = clone(same); ev.events = ['push'];
yes('an extra event is named', compare(rec, ev).join() === 'is sent the push event, which the record does not list');
yes('a missing event is named', compare(Object.assign({}, rec, { events: ['issues'] }), same).join() === 'is not sent the issues event, which the record lists');
const other = clone(same); other.id = 8;
yes('another App behind the slug is named', /names another App now/.test(compare(rec, other).join()));

// 3. the script for real
console.log('3. the script against a stand-in GitHub');
const TOKEN = 'ghs_standin' + 'x'.repeat(30);
function standIn(apps) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization || '' });
    const m = /^\/apps\/([a-z0-9-]+)$/.exec(req.url);
    const a = m && apps[m[1]];
    // a slug set to 403 stands for a private App, which GitHub keeps from a run's token
    if (a === 403) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'Resource not accessible by integration' })); return; }
    res.writeHead(a ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(a || { message: 'Not Found' }));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: 'http://127.0.0.1:' + server.address().port })));
}
function run(url, record) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-app-perms-'));
  const file = path.join(dir, 'github-apps.json');
  fs.writeFileSync(file, JSON.stringify(record));
  return new Promise(resolve => {
    const p = spawn(process.execPath, [SCRIPT], { env: Object.assign({}, process.env, { THORNSWOOD_GITHUB_API: url, THORNSWOOD_APPS_RECORD: file, GH_TOKEN: TOKEN }) });
    let out = '';
    p.stdout.on('data', c => { out += c; });
    p.stderr.on('data', c => { out += c; });
    p.on('close', code => { fs.rmSync(dir, { recursive: true, force: true }); resolve({ code, out }); });
  });
}
function asGitHub(record) {
  const o = {};
  record.apps.forEach((a, i) => { o[a.slug] = { id: a.id || 9000 + i, slug: a.slug, permissions: clone(a.permissions), events: clone(a.events) }; });
  return o;
}

(async () => {
  let s = await standIn(asGitHub(real));
  let r = await run(s.url, real);
  yes('every App matching passes, exit 0', r.code === 0 && /every app holds exactly what/.test(r.out) && !/FAIL/.test(r.out));
  yes('  one line per App', real.apps.every(a => r.out.indexOf('PASS  ' + a.slug + ' ') >= 0));
  yes('  the token reaches GitHub as a bearer token', s.seen.length === real.apps.length && s.seen.every(x => x.auth === 'Bearer ' + TOKEN));
  yes('  and is never printed', r.out.indexOf(TOKEN) < 0);
  s.server.close();

  const gh = asGitHub(real);
  gh['thornswood-workers'].permissions.workflows = 'write';
  delete gh['thornswood-watch'];
  gh['thornswood-board'] = 403;
  s = await standIn(gh);
  r = await run(s.url, real);
  yes('an App holding more fails, exit 1, and names it', r.code === 1 && /FAIL  thornswood-workers holds workflows write, which the record does not give it/.test(r.out));
  yes('an App GitHub will not show fails with its answer', /FAIL  thornswood-watch: GitHub answered 404: Not Found/.test(r.out));
  yes('  a private App says so, and how it is made readable', /FAIL  thornswood-board: GitHub answered 403: Resource not accessible by integration \(a private App: .*made public on its Advanced settings page/.test(r.out));
  yes('  the others still pass', /PASS  thornswood-bramble /.test(r.out) && /3 of 6 apps differ/.test(r.out));
  s.server.close();

  const broken = clone(real); delete broken.apps[1].why.contents;
  s = await standIn(asGitHub(real));
  r = await run(s.url, broken);
  yes('a record that breaks its rules fails before GitHub is asked', r.code === 1 && /contents has no why/.test(r.out) && s.seen.length === 0);
  s.server.close();

  // 4. the nightly runs it
  console.log('4. the nightly');
  const night = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'nightly.yml'), 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout has CRLF
  const step = /- name: Each GitHub App holds only what its record gives it\n([\s\S]*?)(?=\n      - name:|\n  [a-z]+:\n)/.exec(night);
  yes('nightly.yml has the step', !!step);
  yes('  it runs this script', !!step && /node scripts\/dev\/Check-AppPermissions\.js/.test(step[1]));
  yes('  with the run\'s own token and no secret', !!step && /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/.test(step[1]) && !/secrets\.(?!GITHUB_TOKEN)/.test(step[1]));
  yes('  in the main-only job', (() => { const i = night.indexOf('- name: Each GitHub App holds only what its record gives it'); const j = night.indexOf('\n  harnesses:'); return i > 0 && i < j && night.indexOf("if: github.ref == 'refs/heads/main'") < i; })());

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + e.stack); process.exit(1); });
