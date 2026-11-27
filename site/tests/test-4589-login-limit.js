'use strict';
/*
  test-4589-login-limit.js

      node .\site\tests\test-4589-login-limit.js
      node .\site\tests\test-4589-login-limit.js <an older server.js>

  Issue #4589. POST /api/login answers 429 "Too many sign-in attempts" once
  loginWait (lib/limits.js) says one connection has tried LOGIN_MAX times in
  the window, and while the member password is the door each further try
  waits longer than the last (#1308). With the call replaced by
  `const wait = 0;` every site test still passed: no test tried that often.

  Against copies of the site in scratch folders on spare ports. A copy sees
  every request come from 127.0.0.1, as behind Caddy, so each connection is
  told apart by its X-Forwarded-For, the way the door names it.
    A  the member password as the door: one connection's first LOGIN_MAX
       wrong passwords are each 401;
    B  its next try is 429, with Retry-After a whole number of seconds and
       the same number in the words;
    C  the try after that waits longer, and the right password does not get
       past it;
    D  another connection is still asked for the password (401);
    E  with Discord sign in set up, the next try past LOGIN_MAX is 429 too,
       and the one after waits no longer, since no password is read.

  Nothing leaves the machine. The scratch folders are removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const APP = path.join(__dirname, '..', '..', 'site');
const SITE_SRC = path.resolve(process.argv[2] || path.join(APP, 'server.js'));

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300) : '')); }
}

const m = /const LOGIN_MAX = (\d+);/.exec(siteFiles.source(SITE_SRC));
const MAX = m ? Number(m[1]) : 8;
yes('the copy names LOGIN_MAX (' + MAX + ')', !!m);

function login(port, from, password) {
  return new Promise((done) => {
    const text = JSON.stringify({ password });
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/login', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text),
        origin: 'http://127.0.0.1:' + port, 'x-forwarded-for': from } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        let json = null; try { json = JSON.parse(body); } catch (e) { }
        done({ status: res.statusCode, retry: res.headers['retry-after'], json, body });
      });
    });
    req.on('error', (e) => done({ status: 0, body: String(e) }));
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    req.end(text);
  });
}

const made = [];
async function start(password, discord) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4589-'));
  made.push(dir);
  siteFiles.copy(dir, SITE_SRC);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password,
    discord: Object.assign({ clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' }, discord || {}),
    botKey: crypto.randomBytes(16).toString('hex'), admins: [],
    secret: crypto.randomBytes(32).toString('hex'),
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1' })
  });
  const run = { srv, out: '' };
  srv.stdout.on('data', (d) => { run.out += d; });
  srv.stderr.on('data', (d) => { run.out += d; });
  run.port = (await siteFiles.listening(srv)).port;
  return run;
}

// The 429 holds: Retry-After a whole number of seconds, and the words say it.
function refused(r) {
  const secs = Number(r.retry);
  return r.status === 429 && Number.isInteger(secs) && secs >= 1 && !!r.json &&
    /^Too many sign-in attempts/.test(r.json.error || '') && (r.json.error || '').indexOf(' ' + secs + ' seconds') > 0;
}

(async () => {
  const runs = [];
  try {
    const PASSWORD = crypto.randomBytes(12).toString('hex');
    const A = '203.0.113.7', B = '198.51.100.9';

    console.log('\nA. the member password as the door:');
    let run = await start(PASSWORD);
    runs.push(run);
    const first = [];
    for (let i = 0; i < MAX; i++) first.push((await login(run.port, A, 'not it ' + i)).status);
    yes('the first ' + MAX + ' wrong passwords are each 401 (' + first.join(', ') + ')', first.every((s) => s === 401));

    console.log('\nB. the next try:');
    const next = await login(run.port, A, 'not it again');
    yes('is 429 with the wait in seconds, the same in Retry-After and the words (' + next.status + ', ' + next.retry + ')',
      refused(next), next.body);

    console.log('\nC. the try after that:');
    const later = await login(run.port, A, PASSWORD);
    yes('waits longer than the one before (' + next.retry + ' then ' + later.retry + ')',
      refused(later) && Number(later.retry) > Number(next.retry), later.body);
    yes('and the right password does not get past it (' + later.status + ')', later.status === 429 && !/ok/.test(later.body));

    console.log('\nD. another connection:');
    const other = await login(run.port, B, 'not it');
    yes('is still asked for the password (' + other.status + ')', other.status === 401, other.body);

    console.log('\nE. with Discord sign in set up:');
    run = await start(PASSWORD, { clientId: 'x', clientSecret: 'y' });
    runs.push(run);
    const tries = [];
    for (let i = 0; i < MAX; i++) tries.push((await login(run.port, A, 'not it')).status);
    yes('the first ' + MAX + ' are each answered 403, Discord only (' + tries.join(', ') + ')', tries.every((s) => s === 403));
    const d1 = await login(run.port, A, 'not it');
    const d2 = await login(run.port, A, 'not it');
    yes('the next is 429 with the wait in seconds (' + d1.status + ', ' + d1.retry + ')', refused(d1), d1.body);
    yes('and the one after waits no longer (' + d1.retry + ' then ' + d2.retry + ')', refused(d2) && Number(d2.retry) <= Number(d1.retry), d2.body);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, runs.map((r) => r.out).join('\n'));
  } finally {
    for (const r of runs) r.srv.kill();
    for (const d of made) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { console.log('      a scratch folder was not removed: ' + e.message); }
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
