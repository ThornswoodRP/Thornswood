'use strict';
/*
  test-4956-cut-off-upload.js

      node .\site\tests\test-4956-cut-off-upload.js
      node .\site\tests\test-4956-cut-off-upload.js <an older server.js>

  Issue #4956. receiveUpload made the upload's file under its stamped name in
  uploads/ before any bytes came, and took a half file away only from its own
  close handler, which never runs when the site is stopped partway. The half
  file stayed in uploads/ with no note, was listed in the hub as an ordinary
  file, and nothing removed it.

  Against a copy of the site in a scratch folder on a spare port:
    A  an upload of 5 MB stopped by killing the site after 200 KB leaves
       nothing in uploads/ (only in uploads/.part, which nothing lists);
    B  the site started again empties uploads/.part and says so, and the
       half file is in neither folder;
    C  an upload that arrives whole is in uploads/ under its stamped name,
       whole, with nothing left in uploads/.part.

  Nothing leaves the machine. The scratch folder is removed at the end.
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

const dir = fs.mkdtempSync(path.join(process.env.THORNSWOOD_TEMP || os.tmpdir(), 'ts-4956-'));
const PASSWORD = crypto.randomBytes(12).toString('hex');
const UPDIR = path.join(dir, 'uploads');
const PART = path.join(UPDIR, '.part');
const STAMPED = /^\d{8}-\d{4}-[0-9a-f]{12}-/;
const stamped = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []).filter((n) => STAMPED.test(n));
const sizeOf = (d, n) => { try { return fs.statSync(path.join(d, n)).size; } catch (e) { return -1; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PORT = 0, MEMBER = '', out = '';
function start() {
  out = '';
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
      THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
  });
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  return siteFiles.listening(srv).then((r) => { PORT = r.port; return srv; });
}
function stopped(srv) {
  return new Promise((done) => {
    if (srv.exitCode !== null || srv.signalCode) return done();
    srv.once('exit', () => done());
    srv.kill('SIGKILL');
  });
}
/* The hub's member cookie, from the site's own sign in with the password. */
function signIn() {
  return new Promise((done, failed) => {
    const text = JSON.stringify({ password: PASSWORD });
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/api/login', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), origin: 'http://127.0.0.1:' + PORT } }, (res) => {
      res.resume();
      const c = String((res.headers['set-cookie'] || []).find((x) => /^tw=/.test(x)) || '').split(';')[0];
      if (res.statusCode === 200 && c) done(c); else failed(new Error('the hub sign in answered ' + res.statusCode));
    });
    req.on('error', failed);
    req.end(text);
  });
}
function upload(name, total) {
  return http.request({ host: '127.0.0.1', port: PORT, method: 'POST', agent: false,
    path: '/api/upload?name=' + encodeURIComponent(name) + '&by=Ada',
    headers: { 'content-type': 'text/plain', 'content-length': total, cookie: MEMBER, origin: 'http://127.0.0.1:' + PORT } });
}

(async () => {
  let srv = null;
  try {
    siteFiles.copy(dir, SITE_SRC);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: PASSWORD,
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(16).toString('hex'), admins: [],
      secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));
    srv = await start();
    MEMBER = await signIn();

    console.log('A. an upload cut off by the site stopping:');
    const TOTAL = 5 * 1024 * 1024, SENT = 200 * 1024;
    const req = upload('cut.txt', TOTAL);
    req.on('error', () => {});
    req.write(Buffer.alloc(SENT, 'a'));
    // Until the site has the 200 KB on disk, wherever it writes them.
    const t0 = Date.now();
    const had = () => stamped(UPDIR).concat(stamped(PART)).some((n) => sizeOf(stamped(UPDIR).indexOf(n) >= 0 ? UPDIR : PART, n) >= SENT);
    while (!had() && Date.now() - t0 < 10000) await sleep(50);
    yes('the site has the first 200 KB on disk', had(), out);
    await stopped(srv);
    srv = null;
    req.destroy();
    yes('nothing is left in uploads/ (' + stamped(UPDIR).join(', ') + ')', stamped(UPDIR).length === 0);
    const left = stamped(PART);
    yes('the half file is only in uploads/.part (' + left.join(', ') + ')', left.length === 1 && /-cut\.txt$/.test(left[0]));

    console.log('\nB. the site started again:');
    srv = await start();
    yes('uploads/.part is empty (' + stamped(PART).join(', ') + ')', stamped(PART).length === 0);
    yes('and the half file is in neither folder', !stamped(UPDIR).concat(stamped(PART)).some((n) => /-cut\.txt$/.test(n)));
    yes('the site says it removed one cut-off upload', /removed 1 upload\(s\) cut off when the site last stopped/.test(out), out);
    MEMBER = await signIn();

    console.log('\nC. an upload that arrives whole:');
    const body = Buffer.alloc(300 * 1024, 'b');
    const r = await new Promise((done) => {
      const q = upload('whole.txt', body.length);
      q.on('response', (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { } done({ status: res.statusCode, j, t }); }); });
      q.on('error', (e) => done({ status: 0, t: String(e) }));
      q.end(body);
    });
    const kept = stamped(UPDIR).filter((n) => /-whole\.txt$/.test(n));
    yes('is taken (' + r.status + ')', r.status === 200, r.t);
    yes('and is in uploads/ under its stamped name, whole', kept.length === 1 && sizeOf(UPDIR, kept[0]) === body.length);
    yes('with nothing left in uploads/.part', stamped(PART).length === 0);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, out);
  } finally {
    if (srv) await stopped(srv);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
