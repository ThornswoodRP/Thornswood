'use strict';
/*
  test-2354-signin-retention.js

      node .\site\tests\test-2354-signin-retention.js
      node .\site\tests\test-2354-signin-retention.js <an older server.js>

  Issue #2354: sign-in records hold the address a connection reached the site
  from, and site/data/site/privacy.md says they are deleted after 30 days,
  "enforced by the site rather than promised". The ageing writes the file
  back without the old rows, and a write that failed was dropped with nothing
  said, so a row past thirty days could stay on disk with nobody told.

  Against a real copy of site\server.js in a scratch folder on a spare port,
  this makes that write really fail (signins.json read only, which Windows
  will not replace) and asks /api/signins as an admin:
    - the answer still leaves the old row out;
    - the site's log says the write failed, with the counts and nothing a
      row holds;
    - once the file can be written, the old row goes from disk and nothing
      more is said.

  The read only file is a failure on Windows, where the site runs; elsewhere a
  read only file in a writable folder can be replaced, so it says SKIP.
  Nothing leaves the machine and the scratch folder is removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const APP = path.join(__dirname, '..', '..', 'site');
const SITE_SRC = process.argv[2] || path.join(APP, 'server.js');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}
if (process.platform !== 'win32') {
  console.log('SKIP  a read only file stops the write only on Windows, where the site runs');
  console.log('\n0 passed, 0 failed');
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2354-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_ID = '111111111111111111';
siteFiles.copy(dir, SITE_SRC);
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
  botKey: crypto.randomBytes(16).toString('hex'),
  admins: [ADMIN_ID],
  secret: SECRET,
  gameCheckPort: 1,
  onlineFile: path.join(dir, 'online.json')
}, null, 2));
const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const adminCookie = () => {
  const at = Date.now();
  return 'twa=' + encodeURIComponent(ADMIN_ID + '|Admin|' + at + '|' + sign(ADMIN_ID + '|Admin|' + at));
};

const SIGNINS = path.join(dir, 'data', 'signins.json');
const DAY = 86400000;
const OLD = { at: Date.now() - 45 * DAY, id: '999', handle: 'old-row-handle', ip: '203.0.113.9', outcome: 'allowed' };
const NEW = { at: Date.now() - DAY, id: '998', handle: 'new-row-handle', ip: '203.0.113.8', outcome: 'allowed' };
fs.writeFileSync(SIGNINS, JSON.stringify([NEW, OLD], null, 2));
fs.chmodSync(SIGNINS, 0o444);

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
let PORT = 0;
function ask(where) {
  return new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'GET', path: where,
                               headers: { cookie: adminCookie() }, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { }
        done({ status: res.statusCode, json: json });
      });
    });
    req.on('error', (e) => done({ status: 0, json: null }));
    req.end();
  });
}

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_DOCS_LOCAL: '1',
                                          THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      if (out.indexOf('listening on ') >= 0) { up = true; break; }
      if (srv.exitCode !== null) break;
      await wait(50);
    }
    if (!up) throw new Error('the scratch site never came up:\n' + out);

    const from = out.length;
    let r = await ask('/api/signins');
    yes('an admin asking while the file cannot be written is still answered without the old row (' + r.status + ')',
        r.status === 200 && r.json && r.json.signins.length === 1 && r.json.signins[0].id === '998');
    await wait(100);
    const line = out.slice(from).split('\n').find((l) => l.indexOf('signin-retention') >= 0) || '';
    let doc = null;
    try { doc = JSON.parse(line.slice(line.indexOf('{'))); } catch (e) { }
    yes('the site\'s log says the write failed, with the counts (' + line.trim() + ')',
        !!doc && doc.event === 'write-failed' && doc.rows === 2 && doc.kept === 1);
    yes('and nothing a row holds', line.indexOf('203.0.113') < 0 && line.indexOf('row-handle') < 0 && line.indexOf('999') < 0);
    yes('the old row is still on disk, which is what was said', fs.readFileSync(SIGNINS, 'utf8').indexOf('old-row-handle') >= 0);

    fs.chmodSync(SIGNINS, 0o644);
    const again = out.length;
    r = await ask('/api/signins');
    await wait(100);
    yes('once the file can be written, the old row goes from disk',
        r.status === 200 && fs.readFileSync(SIGNINS, 'utf8').indexOf('old-row-handle') < 0);
    yes('and nothing more is said', out.slice(again).indexOf('signin-retention') < 0);
  } catch (err) {
    fail++;
    console.log('FAIL  the harness itself threw: ' + (err && err.stack ? err.stack : err));
  }
  await new Promise((ok) => {
    srv.on('exit', ok);
    try { srv.kill(); } catch (e) { ok(); }
    setTimeout(ok, 3000);
  });
  try { fs.chmodSync(SIGNINS, 0o644); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
